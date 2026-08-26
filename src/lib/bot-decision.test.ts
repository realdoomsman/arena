// Executor-limit and control-bot proofs.
//
// Alpha Arena's models hallucinated tickers, sized positions wildly, and
// ignored their own stated rules — "a prompt is a suggestion." Everything here
// tests the layer that assumes the model misbehaved.
//
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateDecision,
  MAX_ACTIONS_PER_WAKE,
  MAX_BUY_FRACTION,
  MIN_TRADE_LAMPORTS,
  type Decision,
  type MarketSnapshot,
} from "./bot-decision";
import { monkeyDecision, indexDecision, diamondDecision } from "./bot-controls";
import type { EligibleToken } from "./bot-universe";

const SOL = 1_000_000_000;

function tok(idx: number, symbol: string, liquidityUsd: number): EligibleToken {
  return {
    idx,
    mint: `mint${idx}`,
    symbol,
    name: symbol,
    priceUsd: 1,
    change24h: null,
    change1h: null,
    liquidityUsd,
    mcapUsd: null,
    organicScore: null,
    holders: null,
    launchpad: null,
    fresh: false,
  };
}

const ELIGIBLE = [tok(0, "AAA", 900_000), tok(1, "BBB", 800_000), tok(2, "CCC", 700_000)];

function snap(over: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    ts: 1_000_000,
    navLamports: 10 * SOL,
    idleLamports: 10 * SOL,
    positions: [],
    eligible: ELIGIBLE,
    recent: [],
    lessons: [],
    ...over,
  };
}

function ctx(over: Partial<Parameters<typeof validateDecision>[1]> = {}) {
  return {
    eligible: ELIGIBLE,
    navLamports: 10 * SOL,
    idleLamports: 10 * SOL,
    heldMints: new Set<string>(),
    ...over,
  };
}

// ── The hallucinated-ticker failure ────────────────────────────────────────

test("a buy index off the end of the list is dropped, not coerced", () => {
  const d: Decision = { rationale: "", actions: [{ kind: "buy", idx: 99, fraction: 0.1 }] };
  const { actions, notes } = validateDecision(d, ctx());
  assert.equal(actions.length, 0, "nothing executes");
  assert.match(notes[0].reason, /not on the eligible list/);
});

test("selling something the bot does not hold is dropped", () => {
  const d: Decision = { rationale: "", actions: [{ kind: "sell", mint: "ghost", fraction: 1 }] };
  const { actions, notes } = validateDecision(d, ctx());
  assert.equal(actions.length, 0);
  assert.match(notes[0].reason, /not currently held/);
});

// ── Sizing discipline ──────────────────────────────────────────────────────

test("an oversized buy is clamped, not refused", () => {
  const d: Decision = { rationale: "", actions: [{ kind: "buy", idx: 0, fraction: 0.9 }] };
  const { actions, notes } = validateDecision(d, ctx());
  assert.equal(actions.length, 1, "the trade still happens");
  assert.ok(
    actions[0].kind === "buy" && actions[0].fraction <= MAX_BUY_FRACTION + 1e-9,
    "but never above the cap"
  );
  assert.match(notes[0].reason, /clamped/);
});

test("the cash floor cannot be breached", () => {
  // Nearly fully deployed already: only 5% of NAV is idle, floor is 10%.
  const d: Decision = { rationale: "", actions: [{ kind: "buy", idx: 0, fraction: 0.25 }] };
  const { actions, notes } = validateDecision(
    d,
    ctx({ idleLamports: 0.5 * SOL, heldMints: new Set(["mint1"]) })
  );
  assert.equal(actions.length, 0, "a bot that cannot react is a bot that cannot act");
  assert.match(notes[0].reason, /cash floor|dust/);
});

test("dust trades are refused", () => {
  const tiny = MIN_TRADE_LAMPORTS / 2 / (10 * SOL);
  const d: Decision = { rationale: "", actions: [{ kind: "buy", idx: 0, fraction: tiny }] };
  const { actions } = validateDecision(d, ctx());
  assert.equal(actions.length, 0);
});

test("overtrading is capped", () => {
  const d: Decision = {
    rationale: "",
    actions: Array.from({ length: 10 }, () => ({ kind: "buy" as const, idx: 0, fraction: 0.02 })),
  };
  const { actions } = validateDecision(d, ctx());
  assert.ok(actions.length <= MAX_ACTIONS_PER_WAKE, `got ${actions.length}`);
});

// ── The controls ───────────────────────────────────────────────────────────

test("Monkey only ever picks from the eligible list", () => {
  // Sweep the whole rng range; every buy must land on a real index.
  for (let i = 0; i < 200; i++) {
    const r = i / 200;
    const d = monkeyDecision(snap(), () => r);
    for (const a of d.actions) {
      if (a.kind === "buy") {
        assert.ok(a.idx >= 0 && a.idx < ELIGIBLE.length, `idx ${a.idx} out of range at rng=${r}`);
      }
    }
  }
});

test("Monkey sells sometimes, so it is not secretly a second Diamond", () => {
  const withPos = snap({
    positions: [
      { mint: "mint0", symbol: "AAA", qty: 1, valueLamports: SOL, costLamports: SOL, pnlPct: 0, heldHours: 5 },
    ],
  });
  const sells = monkeyDecision(withPos, () => 0.1).actions.filter((a) => a.kind === "sell");
  const buys = monkeyDecision(withPos, () => 0.9).actions.filter((a) => a.kind === "buy");
  assert.equal(sells.length, 1, "low roll sells");
  assert.equal(buys.length, 1, "high roll buys");
});

test("Index does nothing except on rebalance week", () => {
  const justRebalanced = indexDecision(snap(), snap().ts - 1000);
  assert.equal(justRebalanced.actions.length, 0);

  const due = indexDecision(snap(), snap().ts - 8 * 24 * 60 * 60_000);
  assert.ok(due.actions.length > 0, "a week later it acts");
});

test("Index exits names that fell out of the top ten", () => {
  const holding = snap({
    positions: [
      { mint: "stale", symbol: "OLD", qty: 1, valueLamports: SOL, costLamports: SOL, pnlPct: 0, heldHours: 200 },
    ],
  });
  const d = indexDecision(holding, null);
  assert.ok(
    d.actions.some((a) => a.kind === "sell" && a.mint === "stale"),
    "the dropped name is sold"
  );
});

test("Diamond buys once and then never acts again", () => {
  const first = diamondDecision(snap(), false);
  assert.ok(first.actions.length > 0, "genesis buy happens");
  assert.ok(first.actions.every((a) => a.kind === "buy"), "and it is all buys");

  const later = diamondDecision(snap({ ts: snap().ts + 5 * 365 * 24 * 3600_000 }), true);
  assert.equal(later.actions.length, 0, "five years later, still nothing");
});

test("no control ever emits a sell it cannot back, once validated", () => {
  // Run each control's output through the real executor with an empty book.
  for (const d of [monkeyDecision(snap(), () => 0.5), indexDecision(snap(), null), diamondDecision(snap(), false)]) {
    const { actions } = validateDecision(d, ctx());
    for (const a of actions) {
      assert.notEqual(a.kind, "sell", "nothing is sold from an empty book");
    }
  }
});

// ── Identity ───────────────────────────────────────────────────────────────

test("every bot has a persona, and no two share an X handle", async () => {
  const { assertPersonasComplete, PERSONAS } = await import("./bot-persona");
  const { BOT_ROSTER } = await import("./bots");
  assertPersonasComplete();
  assert.equal(Object.keys(PERSONAS).length, BOT_ROSTER.length);
});

test("persona voice never leaks into the trading prompt", async () => {
  // The shared prompt is what makes the leaderboard about models rather than
  // about my character writing. If a voice string ever appears in it, the
  // experiment is contaminated.
  const { SHARED_SYSTEM_PROMPT } = await import("./bots");
  const { PERSONAS } = await import("./bot-persona");
  for (const p of Object.values(PERSONAS)) {
    assert.ok(
      !SHARED_SYSTEM_PROMPT.includes(p.voice),
      `${p.slug}'s voice leaked into the shared trading prompt`
    );
    assert.ok(
      !SHARED_SYSTEM_PROMPT.toLowerCase().includes(p.handle.toLowerCase()),
      `${p.slug}'s handle leaked into the shared trading prompt`
    );
  }
});
