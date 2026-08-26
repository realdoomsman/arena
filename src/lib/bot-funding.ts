// Creator-fee revenue, recycled into the bots.
//
// Fees are split EQUALLY across every bot, not pro-rata to popularity or to
// performance. Equal is the whole point: it keeps the eleven books close
// enough in size that they stay comparable, which is what stops a popular bot
// from being punished for its own popularity through worse fills on thin
// pools. It also means an unloved bot is never starved into irrelevance.
//
// ── AN INJECTION MINTS NO UNITS ─────────────────────────────────────────────
// SOL arrives, the unit count does not change, so every existing unit is
// backed by more SOL. That is precisely how the fee stream reaches holders.
// It is also why the wallet balance cannot be the performance number, and why
// perf_index deliberately ignores these flows: a bot topped up all month has
// not earned anything, and the leaderboard must keep saying so.
import { getDb } from "./db";
import { getBotNav, recordFlow, type BotRow } from "./bot-nav";
import { listBots } from "./bot-nav";
import { buildSolTransfer } from "./swap";
import { signSendConfirmOneWith, LAMPORTS_PER_SOL } from "./accounts";
import { invalidateWallet } from "./wallets";

export class FundingError extends Error {}

/** Below this a transfer costs more in network fees than it delivers. */
const MIN_INJECTION_LAMPORTS = 50_000;

export type InjectionResult = {
  perBotLamports: number;
  injected: { slug: string; lamports: number; signature: string }[];
  failed: { slug: string; reason: string }[];
};

/**
 * Split a pot of SOL equally across the roster and inject it.
 *
 * The source wallet is the treasury. Each transfer is confirmed before its
 * ledger row is written, so a transfer that never lands cannot appear in the
 * books as though it did.
 */
export async function injectFees(args: {
  totalLamports: number;
  treasuryWallet: string;
  treasuryEncryptedKey: string;
}): Promise<InjectionResult> {
  const bots = listBots(true);
  if (bots.length === 0) throw new FundingError("no bots to fund");

  const perBot = Math.floor(args.totalLamports / bots.length);
  const result: InjectionResult = { perBotLamports: perBot, injected: [], failed: [] };

  if (perBot < MIN_INJECTION_LAMPORTS) {
    throw new FundingError(
      `${(args.totalLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL across ${bots.length} bots is ${perBot} lamports each — below the dust threshold`
    );
  }

  for (const bot of bots) {
    try {
      // Price the flow against NAV BEFORE the money lands, so the trading
      // period closes at the value that existed without it.
      const nav = await getBotNav(bot);
      if (!nav) {
        result.failed.push({ slug: bot.slug, reason: "NAV unknown — a position could not be priced" });
        continue;
      }

      const tx = await buildSolTransfer(args.treasuryWallet, bot.wallet, perBot);
      const signature = await signSendConfirmOneWith(args.treasuryEncryptedKey, tx);

      recordFlow({
        bot,
        nav,
        userId: null,
        kind: "fee_injection",
        lamports: perBot,
        units: 0, // never anything else — recordFlow throws if it is
        signature,
      });
      invalidateWallet(bot.wallet);
      result.injected.push({ slug: bot.slug, lamports: perBot, signature });
    } catch (e) {
      // One bot's failed transfer must not stop the other ten being funded.
      result.failed.push({ slug: bot.slug, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return result;
}

/** Every injection a bot has received — shown on its ledger. */
export function injectionHistory(botId: number): {
  ts: number;
  lamports: number;
  signature: string | null;
}[] {
  return getDb()
    .prepare(
      `SELECT ts, lamports, signature FROM bot_flows
       WHERE bot_id = ? AND kind = 'fee_injection' ORDER BY ts DESC`
    )
    .all(botId) as { ts: number; lamports: number; signature: string | null }[];
}

/** Total injected across the arena, for the public ledger page. */
export function totalInjected(): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(lamports), 0) AS total FROM bot_flows WHERE kind = 'fee_injection'")
    .get() as { total: number };
  return row.total;
}

export type { BotRow };
