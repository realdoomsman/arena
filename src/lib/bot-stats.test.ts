// Realized-stats proofs.
//
// Win rate and loss control are the numbers the craft brief says matter, so
// the replay that produces them is pinned down with a worked example.
//
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arena-stats-"));
process.env.DATA_DIR = tmp;
process.env.ENCRYPTION_KEY = "0".repeat(64);

const { botTradeStats, sparkline } = await import("./bot-stats");
const { provisionBots } = await import("./bot-provision");
const { getBot } = await import("./bot-nav");
const { getDb } = await import("./db");

const SOL = 1_000_000_000;
const HOUR = 3_600_000;

function fill(botId: number, ts: number, mint: string, side: string, lamports: number, qty: number) {
  getDb()
    .prepare(
      `INSERT INTO bot_trades (bot_id, decision_id, ts, mint, symbol, side, lamports, qty, price, signature)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0, 'sig')`
    )
    .run(botId, ts, mint, mint.toUpperCase(), side, lamports, qty);
}

test("the worked example: one winner, one loser, average-cost basis", () => {
  provisionBots();
  const bot = getBot("monkey")!;
  const t0 = Date.now() - 100 * HOUR;

  // Winner: buy 100 DOG for 1 SOL, sell all for 3 SOL after 10h → +2 SOL.
  fill(bot.id, t0, "dog", "buy", 1 * SOL, 100);
  fill(bot.id, t0 + 10 * HOUR, "dog", "sell", 3 * SOL, 100);

  // Loser: buy 200 CAT for 2 SOL in two buys, sell half for 0.5 SOL after 4h
  // → cost of sold half = 1 SOL → −0.5 SOL realized; the rest stays open.
  fill(bot.id, t0, "cat", "buy", 1 * SOL, 100);
  fill(bot.id, t0 + 1 * HOUR, "cat", "buy", 1 * SOL, 100);
  fill(bot.id, t0 + 4 * HOUR, "cat", "sell", 0.5 * SOL, 100);

  const s = botTradeStats(bot.id);
  assert.equal(s.closedTrades, 2);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 1);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.realizedLamports, 2 * SOL - 0.5 * SOL);
  assert.equal(s.bestLamports, 2 * SOL);
  assert.equal(s.worstLamports, -0.5 * SOL);
  assert.ok(Math.abs((s.avgHoldHours ?? 0) - 7) < 0.01, `avg of 10h and 4h holds, got ${s.avgHoldHours}`);
});

test("a sell with no recorded buy behind it is skipped, not invented", () => {
  const bot = getBot("index")!;
  fill(bot.id, Date.now(), "ghost", "sell", 1 * SOL, 50);
  const s = botTradeStats(bot.id);
  assert.equal(s.closedTrades, 0, "no basis, no verdict");
});

test("sparkline downsamples but always keeps the latest point", () => {
  const bot = getBot("diamond")!;
  const db = getDb();
  const now = Date.now();
  for (let i = 0; i < 200; i++) {
    db.prepare(
      `INSERT INTO bot_snapshots (bot_id, ts, nav_lamports, sol_lamports, units, nav_per_unit, perf_index, holdings)
       VALUES (?, ?, 1, 1, 1, 1, ?, '[]')`
    ).run(bot.id, now - (200 - i) * 60_000, i);
  }
  const s = sparkline(bot.id, 7, 40);
  assert.equal(s.length, 40);
  assert.equal(s[s.length - 1], 199, "the current value survives downsampling");
});
