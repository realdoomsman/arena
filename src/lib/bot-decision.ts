// The decision contract.
//
// Models and controls produce the SAME shape, so the engine executes both
// through one code path. That is not tidiness for its own sake: if the models
// went through a different executor than the controls, the controls would stop
// being a valid baseline — any difference in fees, sizing or slippage would
// show up as a performance difference that had nothing to do with judgement.
import type { EligibleToken } from "./bot-universe";

/**
 * A buy names EITHER an index into the eligible list (the fast path) OR any
 * Solana mint address directly (INFINITE MODE: the universe is the chain, not
 * the discovery feeds).
 *
 * The safety boundary is the EXECUTOR, not the address book: every buy —
 * listed or not — passes the same execution-time gates (freeze authority,
 * mint authority, rug flag, holder concentration) and must be routable and
 * priceable, or the leg is refused and the refusal published. Token metadata
 * remains attacker-controlled text; a model talked into naming a mint it saw
 * in a token name still cannot buy anything the gates reject.
 */
export type BotAction =
  | { kind: "buy"; idx?: number; mint?: string; fraction: number }
  | { kind: "sell"; mint: string; fraction: number };

/** Base58 shape of a Solana address — 32 to 44 chars, no 0/O/I/l. */
export const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type Decision = {
  /** Published verbatim. Never edited, however it reads in hindsight. */
  rationale: string;
  actions: BotAction[];
};

/** What a bot is shown at each wake-up. Identical across the whole roster. */
export type MarketSnapshot = {
  ts: number;
  navLamports: number;
  idleLamports: number;
  /** SOL's own 24h move — the regime every memecoin trades inside. */
  solChange24h?: number | null;
  positions: {
    mint: string;
    symbol: string;
    qty: number;
    valueLamports: number;
    costLamports: number;
    pnlPct: number;
    heldHours: number;
  }[];
  eligible: EligibleToken[];
  /** The bot's own recent decisions and how they turned out. Never another bot's. */
  recent: { ts: number; rationale: string; actions: BotAction[]; outcome: string | null }[];
  /** Lessons the bot wrote about itself in its last reflection. */
  lessons: string[];
  /** Screened notes from this bot's own backers. Advisory, untrusted data. */
  backerNotes?: { text: string; stakeUsd: number }[];
};

// ── Executor limits ─────────────────────────────────────────────────────────
// INFINITE MODE: No artificial caps on position size, trading frequency, or cash deployment
// Safety gates remain (safety checks, authority verification, rug detection)
// but strategic constraints are removed - let the models deploy however they want

/** NO LIMIT on trades per wake-up. Bots decide their own cadence. */
export const MAX_ACTIONS_PER_WAKE = Infinity;
/** NO LIMIT on position size. A bot can put 100% of NAV into one position if it wants. */
export const MAX_BUY_FRACTION = 1.0;
/** Below this a swap costs more in fees and slippage than the position is worth. */
export const MIN_TRADE_LAMPORTS = 8_000_000; // ~0.008 SOL
/** NO CASH FLOOR. Bots can deploy 100% of capital if they choose. */
export const CASH_FLOOR_FRACTION = 0;

export class DecisionError extends Error {}

export type ValidationNote = { action: BotAction; kept: boolean; reason: string };

/**
 * Bring a raw decision inside the rules.
 *
 * Returns the actions that survive plus a note per action, because the notes
 * are published too: "the model asked to do X and the executor refused" is
 * exactly the kind of thing a leaderboard should show rather than hide.
 */
export function validateDecision(
  decision: Decision,
  ctx: {
    eligible: EligibleToken[];
    navLamports: number;
    idleLamports: number;
    heldMints: Set<string>;
    /** Current value of held positions, so sells can fund later buys in the same wake. */
    positions?: { mint: string; valueLamports: number }[];
  }
): { actions: BotAction[]; notes: ValidationNote[] } {
  const notes: ValidationNote[] = [];
  const actions: BotAction[] = [];
  const positionValue = new Map((ctx.positions ?? []).map((p) => [p.mint, p.valueLamports]));

  let projectedIdle = ctx.idleLamports;
  const floor = Math.floor(ctx.navLamports * CASH_FLOOR_FRACTION);

  for (const raw of decision.actions ?? []) {
    if (actions.length >= MAX_ACTIONS_PER_WAKE) {
      notes.push({ action: raw, kept: false, reason: `over the ${MAX_ACTIONS_PER_WAKE}-action cap` });
      continue;
    }

    if (raw.kind === "buy") {
      const byMint = raw.idx === undefined || raw.idx === null;
      if (byMint) {
        // A direct-mint buy: any token on Solana. The address must at least
        // LOOK like an address — everything else (does it exist, is it safe,
        // can it be routed) is the executor's job, where refusals are
        // published rather than silently swallowed.
        if (typeof raw.mint !== "string" || !MINT_RE.test(raw.mint)) {
          notes.push({ action: raw, kept: false, reason: "not a valid mint address" });
          continue;
        }
      } else if (!Number.isInteger(raw.idx) || raw.idx! < 0 || raw.idx! >= ctx.eligible.length) {
        // An index outside the list is the hallucinated-ticker failure. It is
        // dropped rather than coerced to a neighbour — buying a different
        // token than the one asked for is worse than not trading.
        notes.push({ action: raw, kept: false, reason: "index is not on the eligible list" });
        continue;
      }
      const frac = Math.min(Math.max(raw.fraction ?? 0, 0), MAX_BUY_FRACTION);
      if (!(frac > 0)) {
        notes.push({ action: raw, kept: false, reason: "zero size" });
        continue;
      }
      let lamports = Math.floor(ctx.navLamports * frac);
      if (projectedIdle - lamports < floor) lamports = Math.max(0, projectedIdle - floor);
      if (lamports < MIN_TRADE_LAMPORTS) {
        notes.push({ action: raw, kept: false, reason: "would breach the cash floor or be dust" });
        continue;
      }
      projectedIdle -= lamports;
      const clamped: BotAction = byMint
        ? { kind: "buy", mint: raw.mint, fraction: lamports / ctx.navLamports }
        : { kind: "buy", idx: raw.idx, fraction: lamports / ctx.navLamports };
      actions.push(clamped);
      notes.push({
        action: clamped,
        kept: true,
        reason:
          frac !== raw.fraction
            ? `size clamped from ${((raw.fraction ?? 0) * 100).toFixed(1)}% to ${(frac * 100).toFixed(1)}%`
            : "ok",
      });
      continue;
    }

    // Sell. Selling something the bot does not hold is a hallucination too.
    if (!ctx.heldMints.has(raw.mint)) {
      notes.push({ action: raw, kept: false, reason: "not currently held" });
      continue;
    }
    const frac = Math.min(Math.max(raw.fraction ?? 0, 0), 1);
    if (!(frac > 0)) {
      notes.push({ action: raw, kept: false, reason: "zero size" });
      continue;
    }
    actions.push({ kind: "sell", mint: raw.mint, fraction: frac });
    notes.push({ action: raw, kept: true, reason: "ok" });

    // Credit the expected proceeds (with a slippage haircut) so a rotation —
    // sell A, buy B in the same wake — is not refused for the cash the sell
    // itself frees up. Legs execute in order, so the cash really does exist by
    // the time the buy fires; if the sell fails on-chain, the buy simply fails
    // on-chain too and both failures are published.
    const held = positionValue.get(raw.mint);
    if (held && held > 0) {
      projectedIdle += Math.floor(held * frac * 0.98);
    }
  }

  return { actions, notes };
}
