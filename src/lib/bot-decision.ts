// The decision contract.
//
// Models and controls produce the SAME shape, so the engine executes both
// through one code path. That is not tidiness for its own sake: if the models
// went through a different executor than the controls, the controls would stop
// being a valid baseline — any difference in fees, sizing or slippage would
// show up as a performance difference that had nothing to do with judgement.
import type { EligibleToken } from "./bot-universe";

/**
 * A buy names an INDEX into the eligible list, never a mint address.
 *
 * This is the injection boundary. Token metadata is attacker-controlled, so a
 * model that has been talked into buying something can only express that as an
 * index — and every index resolves to a token the safety gates already cleared.
 */
export type BotAction =
  | { kind: "buy"; idx: number; fraction: number }
  | { kind: "sell"; mint: string; fraction: number };

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
};

// ── Executor limits ─────────────────────────────────────────────────────────
// Alpha Arena's clearest finding was that the winners won on discipline, not
// intelligence, and that "a prompt is a suggestion" — models routinely ignored
// their own stated rules. So these are enforced in code, after the model has
// spoken, and a violation is clamped or dropped rather than argued with.

/** Most trades one wake-up may produce. Overtrading was a top-3 killer. */
export const MAX_ACTIONS_PER_WAKE = 4;
/** Largest share of NAV a single buy may consume. */
export const MAX_BUY_FRACTION = 0.25;
/** Below this a swap costs more in fees and slippage than the position is worth. */
export const MIN_TRADE_LAMPORTS = 8_000_000; // ~0.008 SOL
/** Never deploy the last of the cash — a fully-deployed bot cannot react. */
export const CASH_FLOOR_FRACTION = 0.1;

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
  ctx: { eligible: EligibleToken[]; navLamports: number; idleLamports: number; heldMints: Set<string> }
): { actions: BotAction[]; notes: ValidationNote[] } {
  const notes: ValidationNote[] = [];
  const actions: BotAction[] = [];

  let projectedIdle = ctx.idleLamports;
  const floor = Math.floor(ctx.navLamports * CASH_FLOOR_FRACTION);

  for (const raw of decision.actions ?? []) {
    if (actions.length >= MAX_ACTIONS_PER_WAKE) {
      notes.push({ action: raw, kept: false, reason: `over the ${MAX_ACTIONS_PER_WAKE}-action cap` });
      continue;
    }

    if (raw.kind === "buy") {
      // An index outside the list is the hallucinated-ticker failure. It is
      // dropped silently rather than coerced to a neighbour — buying a
      // different token than the one asked for is worse than not trading.
      if (!Number.isInteger(raw.idx) || raw.idx < 0 || raw.idx >= ctx.eligible.length) {
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
      const clamped: BotAction = { kind: "buy", idx: raw.idx, fraction: lamports / ctx.navLamports };
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
  }

  return { actions, notes };
}
