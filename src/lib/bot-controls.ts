// The three bots that do no thinking.
//
// These are the most important bots on the board. A rising memecoin market
// makes every model look brilliant, and without something mindless running at
// the same size on the same clock there is no way to separate judgement from
// beta. Alpha Automata had no random baseline, which is why its results were so
// easy to argue with. Ours will not be.
//
// They emit the same Decision shape as the models and run through the same
// executor, so any performance gap is judgement and not plumbing.
import type { Decision } from "./bot-decision";
import { MAX_BUY_FRACTION } from "./bot-decision";
import type { EligibleToken } from "./bot-universe";
import type { MarketSnapshot } from "./bot-decision";

/** Injected so the random control is reproducible under test. */
export type Rng = () => number;

/** How much of NAV each control commits per position. */
const CONTROL_POSITION_FRACTION = 0.2;
/** Index and Diamond both target this many names. */
const BASKET_SIZE = 10;
const WEEK_MS = 7 * 24 * 60 * 60_000;

/**
 * Monkey — picks at random, every hour, forever.
 *
 * It sells a held position at random about a third of the time so that it
 * actually turns over rather than accumulating everything it ever bought;
 * a control that only ever buys would silently become a second Diamond.
 */
export function monkeyDecision(snap: MarketSnapshot, rng: Rng = Math.random): Decision {
  if (snap.eligible.length === 0) {
    return { rationale: "Nothing on the eligible list. Sat still.", actions: [] };
  }

  if (snap.positions.length > 0 && rng() < 0.35) {
    const victim = snap.positions[Math.floor(rng() * snap.positions.length)];
    return {
      rationale: `Random sell. No reason — that is the point.`,
      actions: [{ kind: "sell", mint: victim.mint, fraction: 1 }],
    };
  }

  const pick = snap.eligible[Math.floor(rng() * snap.eligible.length)];
  return {
    rationale: `Random buy: ${pick.symbol}. Chosen with no information whatsoever.`,
    actions: [{ kind: "buy", idx: pick.idx, fraction: CONTROL_POSITION_FRACTION }],
  };
}

/**
 * Index — the ten deepest names, equal weight, rebalanced weekly.
 *
 * Between rebalances it does nothing at all. The weekly cadence is the whole
 * character of the bot: it is what a passive holder would experience, fees and
 * drift included.
 */
export function indexDecision(
  snap: MarketSnapshot,
  lastRebalanceTs: number | null
): Decision {
  const due = lastRebalanceTs === null || snap.ts - lastRebalanceTs >= WEEK_MS;
  if (!due) {
    return { rationale: "Not a rebalance week. Held everything.", actions: [] };
  }

  const target = topByLiquidity(snap.eligible, BASKET_SIZE);
  if (target.length === 0) {
    return { rationale: "Eligible list is empty — nothing to index.", actions: [] };
  }

  const targetMints = new Set(target.map((t) => t.mint));
  const actions: Decision["actions"] = [];

  // Exit anything that fell out of the top ten first, so the proceeds fund
  // the entries in the same wake-up.
  for (const p of snap.positions) {
    if (!targetMints.has(p.mint)) actions.push({ kind: "sell", mint: p.mint, fraction: 1 });
  }

  const held = new Set(snap.positions.map((p) => p.mint));
  const weight = Math.min(1 / BASKET_SIZE, MAX_BUY_FRACTION);
  for (const t of target) {
    if (!held.has(t.mint)) actions.push({ kind: "buy", idx: t.idx, fraction: weight });
  }

  return {
    rationale: `Weekly rebalance to the ${target.length} deepest names, equal weight: ${target
      .map((t) => t.symbol)
      .join(", ")}.`,
    actions,
  };
}

/**
 * Diamond — buys once at genesis and never sells anything, ever.
 *
 * The do-nothing baseline. If the thinking bots cannot beat a wallet that made
 * one decision and then went to sleep, that is the most useful result the
 * whole arena could produce.
 */
export function diamondDecision(snap: MarketSnapshot, hasBought: boolean): Decision {
  if (hasBought) {
    return { rationale: "Holding. Diamond never sells.", actions: [] };
  }
  const target = topByLiquidity(snap.eligible, BASKET_SIZE);
  if (target.length === 0) {
    return { rationale: "Eligible list is empty — genesis buy deferred.", actions: [] };
  }
  const weight = Math.min(1 / BASKET_SIZE, MAX_BUY_FRACTION);
  return {
    rationale: `Genesis buy: ${target.map((t) => t.symbol).join(", ")}. This is the only decision Diamond will ever make.`,
    actions: target.map((t) => ({ kind: "buy" as const, idx: t.idx, fraction: weight })),
  };
}

/**
 * The list arrives sorted by liquidity, but sorting here anyway keeps the
 * control honest if that ever changes — a baseline that silently depends on
 * someone else's sort order is not a baseline.
 */
function topByLiquidity(eligible: EligibleToken[], n: number): EligibleToken[] {
  return [...eligible].sort((a, b) => b.liquidityUsd - a.liquidityUsd).slice(0, n);
}
