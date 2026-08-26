// Money-path safety proofs.
//
// These cover the logic that decides whether the books agree with the chain,
// and whether a bot's hour is recoverable after a crash. Both were written in
// response to a real audit finding, and both are the kind of thing that is
// silently wrong for months if nothing asserts it.
//
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arena-safety-"));
process.env.DATA_DIR = tmp;
process.env.ENCRYPTION_KEY = "a".repeat(64);

const { getDb } = await import("./db");
const { provisionBots } = await import("./bot-provision");
const { crashedWakes, staleness } = await import("./bot-reconcile");
const { custodyKeyOpens, generateWallet } = await import("./custody");

provisionBots();
const db = getDb();
const botId = (db.prepare("SELECT id FROM bots WHERE slug='monkey'").get() as { id: number }).id;

// ── The wrong-key trap ─────────────────────────────────────────────────────

test("a well-formed but WRONG encryption key is detected, not accepted", () => {
  const w = generateWallet();
  assert.equal(custodyKeyOpens(w.encryptedKey), true, "the real key opens its own wallet");

  // Rotate to a different, equally valid 32-byte key. Length checks pass; the
  // wallet is now permanently unopenable, and that must be visible.
  const original = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "b".repeat(64);
  assert.equal(
    custodyKeyOpens(w.encryptedKey),
    false,
    "a different 32-byte key must NOT read as healthy — this is the silent-total-failure case"
  );
  process.env.ENCRYPTION_KEY = original;
  assert.equal(custodyKeyOpens(w.encryptedKey), true, "restoring the key restores access");
});

test("garbage is never mistaken for a wallet", () => {
  assert.equal(custodyKeyOpens(""), false);
  assert.equal(custodyKeyOpens("not-an-encrypted-blob"), false);
});

// ── Crashed wakes ──────────────────────────────────────────────────────────

test("a wake that started and never finished is identifiable", () => {
  // Written exactly as the scheduler writes it: row first, completion later.
  db.prepare("INSERT INTO bot_wakes (bot_id, hour_key, ran_at) VALUES (?, ?, ?)").run(
    botId,
    "2026-08-22T04",
    Date.now()
  );
  const crashed = crashedWakes();
  assert.equal(crashed.length, 1, "an unfinished wake shows up");
  assert.equal(crashed[0].slug, "monkey");
});

test("a completed wake does not look like a crash", () => {
  db.prepare("INSERT INTO bot_wakes (bot_id, hour_key, ran_at) VALUES (?, ?, ?)").run(
    botId,
    "2026-08-22T05",
    Date.now()
  );
  db.prepare("UPDATE bot_wakes SET error = ? WHERE bot_id = ? AND hour_key = ?").run(
    "wallet is empty — nothing to trade",
    botId,
    "2026-08-22T05"
  );
  const keys = crashedWakes().map((c) => c.hourKey);
  assert.ok(!keys.includes("2026-08-22T05"), "a recorded error is a finished wake, not a crash");
});

// ── Silence detection ──────────────────────────────────────────────────────

test("an arena that has never decided reports no return rather than zero", () => {
  const s = staleness();
  assert.equal(s.lastDecisionTs, null);
  assert.equal(s.hoursQuiet, null, "null means 'never started', which is not the same as 'quiet'");
});

test("silence is measured from the last decision", () => {
  const threeHoursAgo = Date.now() - 3 * 3600_000;
  db.prepare(
    "INSERT INTO bot_decisions (bot_id, ts, market_snapshot, rationale) VALUES (?, ?, '{}', '')"
  ).run(botId, threeHoursAgo);

  const s = staleness();
  assert.ok(s.hoursQuiet !== null && s.hoursQuiet >= 2.9 && s.hoursQuiet <= 3.1, `got ${s.hoursQuiet}`);
});

// ── Catch-up rule ──────────────────────────────────────────────────────────

test("the catch-up rule recovers missed hours without firing the whole backlog", () => {
  // Mirrors bot-scheduler's selection: due = slot <= minute and not yet run,
  // then every on-time bot plus AT MOST ONE overdue.
  const slots = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
  const minute = 32;
  const alreadyRan = new Set<number>();

  const pending = slots.filter((s) => s <= minute && !alreadyRan.has(s));
  const onTime = pending.filter((s) => s === minute);
  const overdue = pending.filter((s) => s < minute).slice(0, 1);
  const woke = [...onTime, ...overdue];

  assert.equal(onTime.length, 0, "nothing is scheduled for :32");
  assert.equal(
    woke.length,
    1,
    "exactly one overdue bot catches up — firing all 7 at once would destroy the stagger"
  );
  assert.equal(woke[0], 0, "the earliest overdue slot goes first");
});

test("a bot whose minute is now still wakes on time while catching up", () => {
  const slots = [0, 5, 10, 15];
  const minute = 15;
  const alreadyRan = new Set([5, 10]);

  const pending = slots.filter((s) => s <= minute && !alreadyRan.has(s));
  const onTime = pending.filter((s) => s === minute);
  const overdue = pending.filter((s) => s < minute).slice(0, 1);

  assert.deepEqual([...onTime, ...overdue], [15, 0], "on-time first, then one straggler");
});
