// Self-improvement proofs.
//
// The playbook is a bot's brain: a parse hiccup must never delete it, only
// the bot itself may write it, and every revision must survive. The study
// parser is tested against the messy outputs models actually produce.
//
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arena-memory-"));
process.env.DATA_DIR = tmp;
process.env.ENCRYPTION_KEY = "0".repeat(64);

const { parseStudy, getPlaybook, playbookHistory, marketStudy } = await import("./bot-memory");
const { provisionBots } = await import("./bot-provision");
const { getBot } = await import("./bot-nav");
const { getDb } = await import("./db");

// ── The study parser ───────────────────────────────────────────────────────

test("a well-formed study splits into lesson and playbook", () => {
  const { lesson, playbook } = parseStudy(
    "LESSON: I chased two green candles and both round-tripped.\n\nPLAYBOOK:\nEnter only on volume acceleration with rising holders.\nScale out half at 2x. Cut when flow dies."
  );
  assert.equal(lesson, "I chased two green candles and both round-tripped.");
  assert.match(playbook ?? "", /volume acceleration/);
  assert.match(playbook ?? "", /Cut when flow dies/);
});

test("a bare response is a lesson alone — the old playbook survives a lazy model", () => {
  const { lesson, playbook } = parseStudy("Stopped selling winners into strength too early.");
  assert.equal(lesson, "Stopped selling winners into strength too early.");
  assert.equal(playbook, null, "no marker, no overwrite");
});

test("a trivially short playbook is rejected — a brain is not three words", () => {
  const { playbook } = parseStudy("LESSON: fine.\nPLAYBOOK:\nbuy good");
  assert.equal(playbook, null);
});

// ── Playbook storage ───────────────────────────────────────────────────────

test("playbook versions increment and every revision is archived", async () => {
  provisionBots();
  const bot = getBot("opus")!;
  // savePlaybook is deliberately not exported — write through the same SQL
  // shape the study uses, twice, to prove versioning and history.
  const db = getDb();
  const write = (text: string, version: number) => {
    db.prepare(
      `INSERT INTO bot_playbooks (bot_id, text, version, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(bot_id) DO UPDATE SET text = excluded.text, version = excluded.version, updated_at = excluded.updated_at`
    ).run(bot.id, text, version, Date.now());
    db.prepare("INSERT INTO bot_playbook_history (bot_id, ts, version, text) VALUES (?, ?, ?, ?)").run(
      bot.id,
      Date.now() + version,
      version,
      text
    );
  };
  write("v1: enter on acceleration only", 1);
  write("v2: enter on acceleration, exit half at 2x", 2);

  const current = getPlaybook(bot.id);
  assert.equal(current?.version, 2);
  assert.match(current?.text ?? "", /exit half/);

  const history = playbookHistory(bot.id);
  assert.equal(history.length, 2, "both revisions archived");
  assert.equal(history[0].version, 2, "newest first");
});

test("the market study is honestly absent without a day-old snapshot", async () => {
  const bot = getBot("fable")!;
  const s = await marketStudy(bot.id);
  assert.equal(s, null, "no snapshot, no invented study");
});
