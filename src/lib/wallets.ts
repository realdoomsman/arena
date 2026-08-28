// On-chain wallet reads (no API key required).
//
// Arena needs far less of this than Basket did: bot positions are tracked in
// the bot_holdings ledger, so this module exists for the balance SWEEP — the
// self-correcting safety net that catches any drift between what we think a
// bot owns and what the chain says it owns. A ledger that silently disagrees
// with the chain is how pooled accounting goes wrong without anyone noticing.
//
// Data source, keyless: lite-api.jup.ag/ultra/v1/balances/{wallet}
import { getPrices } from "./prices";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/**
 * Assets that bypass the token safety gates.
 *
 * This list is not a convenience — it is a correctness fix. USDC and USDT have
 * both mint AND freeze authority permanently enabled, because an issuer has to
 * be able to mint and to freeze under sanction. Those are the exact two flags
 * that disqualify a memecoin, so running the normal gates over them would
 * exclude the two safest assets on Solana. Verified against RugCheck on
 * 2026-08-21.
 */
export const QUOTE_ASSETS: ReadonlySet<string> = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

type BalancesCache = { data: Record<string, number>; sol: number; ts: number };

declare global {
   
  var __aBalances: Map<string, BalancesCache> | undefined;
   
  var __aSymbols: Map<string, string> | undefined;
}

const balancesCache = (globalThis.__aBalances ??= new Map());
const symbolCache = (globalThis.__aSymbols ??= new Map());

const BALANCES_TTL = 60_000; // bots trade hourly; a stale minute is harmless

/** Drop a wallet's cached balances — call right after a swap confirms. */
export function invalidateWallet(wallet: string): void {
  balancesCache.delete(wallet);
}

/** Record a symbol learned from the eligible-list build, for display later. */
export function rememberSymbol(mint: string, symbol: string): void {
  if (symbol) symbolCache.set(mint, symbol);
}

/** Best-effort symbol for a mint. Falls back to a truncated address. */
export function mintSymbol(mint: string): string {
  return symbolCache.get(mint) || `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

/**
 * Non-frozen token balances of a wallet: mint → uiAmount, plus SOL.
 *
 * Returns null only when the balances endpoint is unreachable AND nothing is
 * cached. Callers must treat null as "unknown", never as "empty wallet" — a
 * sweep that reads an outage as a zero balance would delete a bot's positions
 * from the ledger.
 */
export async function getBalances(
  wallet: string
): Promise<{ tokens: Record<string, number>; sol: number } | null> {
  const cached = balancesCache.get(wallet);
  if (cached && Date.now() - cached.ts < BALANCES_TTL) {
    return { tokens: cached.data, sol: cached.sol };
  }
  try {
    const res = await fetch(`https://lite-api.jup.ag/ultra/v1/balances/${wallet}`, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`balances ${res.status}`);
    const data = (await res.json()) as Record<string, { uiAmount?: number; isFrozen?: boolean }>;
    const tokens: Record<string, number> = {};
    let sol = 0;
    for (const [key, v] of Object.entries(data)) {
      if (key === "SOL") {
        sol = v.uiAmount ?? 0;
      } else if (!v.isFrozen && (v.uiAmount ?? 0) > 0) {
        tokens[key] = v.uiAmount!;
      }
    }
    balancesCache.set(wallet, { data: tokens, sol, ts: Date.now() });
    return { tokens, sol };
  } catch {
    return cached ? { tokens: cached.data, sol: cached.sol } : null;
  }
}

export type WalletHolding = { mint: string; amount: number; priceUsd: number; valueUsd: number };

/**
 * What a wallet actually holds on-chain right now, priced.
 *
 * Null when any held token cannot be priced — the same refusal rule the NAV
 * engine uses. A partially-priced wallet is an unknown total, not a smaller one.
 */
export async function getWalletHoldings(
  wallet: string
): Promise<{ sol: number; holdings: WalletHolding[] } | null> {
  const balances = await getBalances(wallet);
  if (!balances) return null;

  const mints = Object.keys(balances.tokens);
  if (mints.length === 0) return { sol: balances.sol, holdings: [] };

  const prices = await getPrices(mints);
  const holdings: WalletHolding[] = [];
  for (const mint of mints) {
    const priceUsd = prices[mint]?.usdPrice;
    if (priceUsd === undefined || priceUsd === null || !Number.isFinite(priceUsd)) return null;
    const amount = balances.tokens[mint];
    holdings.push({ mint, amount, priceUsd, valueUsd: amount * priceUsd });
  }
  holdings.sort((a, b) => b.valueUsd - a.valueUsd);
  return { sol: balances.sol, holdings };
}
