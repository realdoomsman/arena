// Auto-claim pump.fun creator rewards for the bots.
//
// Each bot wallet is a creator-reward recipient on a pump.fun coin (the split
// is set at coin creation). Creator fees ACCRUE in the program and must be
// CLAIMED. Because the coin has a fee-SHARING config (multiple recipients),
// the official SDK's distribute crank is PERMISSIONLESS: one transaction pays
// every recipient its configured share directly — far cheaper than a separate
// claim per wallet. We crank it on the scheduler's clock.
//
// ── ACCOUNTING ──────────────────────────────────────────────────────────────
// Because WE trigger the claim, we can measure exactly how much SOL each bot
// received (balance delta around the single crank tx) and book it as a
// fee_injection — which raises unit value WITHOUT counting as trading
// performance. That is why creator rewards can land straight in the bot
// wallets and the leaderboard stays honest: the inflow is ours to record, not
// a mystery deposit. Priced against each bot's PRE-crank NAV, same contract as
// injectFees.
//
// Deliberately OPT-IN (ARENA_CREATOR_CLAIM_ENABLED) and only active once
// PUMPFUN_TOKEN_MINT is set — nothing runs until the coin exists.
import { listBots, getBotNav, recordFlow, type BotRow } from "./bot-nav";
import { getSolBalance } from "./accounts";
import { signSendConfirmOneWith } from "./accounts";
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

/**
 * Crank the creator-fee distribution and book each bot's share.
 *
 * Returns null when disabled, a skip note when nothing is distributable, or the
 * signature plus the per-bot lamports recorded. Best-effort: a failure never
 * blocks a wake; the fees simply wait in the program for the next crank.
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
  // minimum distributable amount — no tx, no wasted gas on dust.
  const min = await sdk.getMinimumDistributableFee(mintPk).catch(() => null);
  if (!min || !min.canDistribute) {
    return { signature: null, distributed: [], skipped: "below minimum distributable fee" };
  }

  // The crank only fronts the network fee; whoever pays still receives their
  // own share back in the same tx. Use the bot with the most SOL so the payer
  // can always cover the fee.
  const balancesBefore = new Map<string, number>();
  for (const b of bots) balancesBefore.set(b.wallet, await getSolBalance(b.wallet));
  const payer = [...bots].sort(
    (a, b) => (balancesBefore.get(b.wallet) ?? 0) - (balancesBefore.get(a.wallet) ?? 0)
  )[0];
  if ((balancesBefore.get(payer.wallet) ?? 0) < 10_000) {
    return { signature: null, distributed: [], skipped: "no bot has SOL to pay the crank fee" };
  }

  // Pre-crank NAV per bot, so recordFlow closes the trading period at the value
  // that existed WITHOUT the injection (the injection must not read as trading).
  const navBefore = new Map<number, Awaited<ReturnType<typeof getBotNav>>>();
  for (const b of bots) navBefore.set(b.id, await getBotNav(b).catch(() => null));

  const { instructions } = await sdk.buildDistributeCreatorFeesInstructions(mintPk);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: new PublicKey(payer.wallet),
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      ...instructions,
    ],
  }).compileToV0Message();
  const b64 = Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");

  const signature = await signSendConfirmOneWith(payer.encrypted_key, b64);
  for (const b of bots) invalidateWallet(b.wallet);

  // Measure what each bot actually received and book it. The payer's delta is
  // net of the gas it fronted, which is exactly what it truly received.
  const distributed: { slug: string; lamports: number }[] = [];
  for (const b of bots) {
    const after = await getSolBalance(b.wallet);
    const delta = after - (balancesBefore.get(b.wallet) ?? after);
    if (delta <= 0) continue;
    const nav = navBefore.get(b.id);
    if (!nav) continue; // unpriceable — record on the next crank rather than at a made-up NAV
    recordFlow({
      bot: b,
      nav,
      userId: null,
      kind: "fee_injection",
      lamports: delta,
      units: 0,
      signature,
    });
    distributed.push({ slug: b.slug, lamports: delta });
  }

  const total = distributed.reduce((a, d) => a + d.lamports, 0);
  console.log(
    `[claim] distributed ${(total / 1e9).toFixed(4)} SOL of creator fees across ${distributed.length} bot(s) (sig ${signature.slice(0, 8)}…)`
  );
  return { signature, distributed };
}

export type { BotRow };
