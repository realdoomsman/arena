// Auto-claim pump.fun creator rewards for the bots.
//
// Each bot wallet is a creator-reward recipient on a pump.fun coin whose split
// is set at creation. That makes the coin a fee-SHARING coin, and for those the
// classic per-creator "collect" instruction FAILS (error 6050) — the correct
// mechanic is the pump program's PERMISSIONLESS distribute crank: one tx pays
// every shareholder its configured share directly. (PumpPortal's collectCreatorFee
// is the legacy single-creator path and does not work here — verified against
// pump-public-docs.) The official @pump-fun/pump-sdk builds the instructions,
// handling graduation (it sweeps the PumpSwap AMM vault first), WSOL unwrap,
// and shareholder ordering for us.
//
// ── ACCOUNTING ──────────────────────────────────────────────────────────────
// Because WE trigger the crank, we read the CONFIRMED transaction's per-account
// lamport deltas and book each bot's exact share as a fee_injection — which
// raises unit value WITHOUT counting as trading performance (priced at each
// bot's pre-crank NAV, same contract as injectFees). The crank is paid by a
// NON-shareholder (the treasury if funded) so no bot's delta is muddied by gas;
// if a bot must pay, its own gas is added back so its recorded share stays exact.
//
// Opt-in and inert until PUMPFUN_TOKEN_MINT + ARENA_CREATOR_CLAIM_ENABLED are set.
import { listBots, getBotNav, recordFlow } from "./bot-nav";
import { getSolBalance, signSendConfirmOneWith } from "./accounts";
import { getTreasury } from "./treasury";
import { rpcUrl } from "./swap";
import { invalidateWallet } from "./wallets";

export class ClaimError extends Error {}

export function creatorClaimEnabled(): boolean {
  return Boolean(process.env.PUMPFUN_TOKEN_MINT) && process.env.ARENA_CREATOR_CLAIM_ENABLED === "true";
}

export function creatorClaimIntervalMin(): number {
  const m = Number(process.env.ARENA_CREATOR_CLAIM_INTERVAL_MIN ?? 60);
  return Number.isFinite(m) && m >= 5 ? m : 60;
}

export type ClaimResult = {
  signature: string | null;
  distributed: { slug: string; lamports: number }[];
  skipped?: string;
};

/** Per-account SOL deltas from a confirmed tx: pubkey → (post − pre) lamports.
 *  Race-free and exact — unaffected by anything else touching the wallets. */
async function perAccountDeltas(
  conn: import("@solana/web3.js").Connection,
  signature: string
): Promise<{ deltas: Map<string, number>; fee: number } | null> {
  const tx = await conn
    .getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
    .catch(() => null);
  if (!tx || !tx.meta) return null;
  const keys = tx.transaction.message
    .getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses })
    .keySegments()
    .flat();
  const deltas = new Map<string, number>();
  for (let i = 0; i < keys.length; i++) {
    const pre = tx.meta.preBalances[i] ?? 0;
    const post = tx.meta.postBalances[i] ?? 0;
    deltas.set(keys[i].toBase58(), post - pre);
  }
  return { deltas, fee: tx.meta.fee ?? 0 };
}

/**
 * Crank the creator-fee distribution for the configured coin and book each
 * bot's share. Returns null when disabled, a skip note when nothing is
 * distributable, or the signature plus per-bot lamports. Best-effort: a failure
 * never blocks a wake; the fees wait in the program for the next crank.
 */
export async function claimCreatorFees(): Promise<ClaimResult | null> {
  if (!creatorClaimEnabled()) return null;
  const mint = process.env.PUMPFUN_TOKEN_MINT!;

  const bots = listBots(true);
  if (bots.length === 0) return { signature: null, distributed: [], skipped: "no bots" };

  const { Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } =
    await import("@solana/web3.js");
  const { OnlinePumpSdk } = await import("@pump-fun/pump-sdk");

  const conn = new Connection(rpcUrl(), "confirmed");
  const sdk = new OnlinePumpSdk(conn);
  const mintPk = new PublicKey(mint);

  // Skip (free, simulation-only) while accrued fees are below the program's
  // minimum distributable — no tx, no wasted gas on dust.
  const min = await sdk.getMinimumDistributableFee(mintPk).catch(() => null);
  if (!min || !min.canDistribute) {
    return { signature: null, distributed: [], skipped: "below minimum distributable fee" };
  }

  // Prefer a NON-shareholder payer (treasury) so every bot's delta is exactly
  // its share. Fall back to the richest bot (its gas is added back below so its
  // recorded share stays exact either way).
  const treasury = getTreasury();
  const botBal = new Map<string, number>();
  for (const b of bots) botBal.set(b.wallet, await getSolBalance(b.wallet));
  let payerWallet: string;
  let payerKey: string;
  const treasuryBal = treasury ? await getSolBalance(treasury.wallet) : 0;
  if (treasury && treasuryBal >= 20_000) {
    payerWallet = treasury.wallet;
    payerKey = treasury.encryptedKey;
  } else {
    const richest = [...bots].sort((a, b) => (botBal.get(b.wallet) ?? 0) - (botBal.get(a.wallet) ?? 0))[0];
    if ((botBal.get(richest.wallet) ?? 0) < 20_000) {
      return { signature: null, distributed: [], skipped: "no wallet has SOL to pay the crank fee" };
    }
    payerWallet = richest.wallet;
    payerKey = richest.encrypted_key;
  }

  // Pre-crank NAV per bot, so recordFlow closes the trading period at the value
  // that existed WITHOUT the injection.
  const navBefore = new Map<number, Awaited<ReturnType<typeof getBotNav>>>();
  for (const b of bots) navBefore.set(b.id, await getBotNav(b).catch(() => null));

  const { instructions } = await sdk.buildDistributeCreatorFeesInstructions(mintPk);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: new PublicKey(payerWallet),
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      ...instructions,
    ],
  }).compileToV0Message();
  const b64 = Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");

  const signature = await signSendConfirmOneWith(payerKey, b64);
  for (const b of bots) invalidateWallet(b.wallet);

  // Exact per-bot amounts from the confirmed tx. Fall back to a balance re-read
  // only if the tx cannot be fetched.
  const parsed = await perAccountDeltas(conn, signature);
  const distributed: { slug: string; lamports: number }[] = [];
  for (const b of bots) {
    let delta: number;
    if (parsed) {
      delta = parsed.deltas.get(b.wallet) ?? 0;
      if (b.wallet === payerWallet) delta += parsed.fee; // add back the gas this bot fronted
    } else {
      delta = (await getSolBalance(b.wallet)) - (botBal.get(b.wallet) ?? 0);
      if (b.wallet === payerWallet) delta += 5_000; // approximate a single-sig fee
    }
    if (delta <= 0) continue;
    const nav = navBefore.get(b.id);
    if (!nav) continue; // unpriceable — record on the next crank, never at a made-up NAV
    recordFlow({ bot: b, nav, userId: null, kind: "fee_injection", lamports: delta, units: 0, signature });
    distributed.push({ slug: b.slug, lamports: delta });
  }

  const total = distributed.reduce((a, d) => a + d.lamports, 0);
  console.log(
    `[claim] distributed ${(total / 1e9).toFixed(4)} SOL of creator fees across ${distributed.length} bot(s) (sig ${signature.slice(0, 8)}…)`
  );
  return { signature, distributed };
}
