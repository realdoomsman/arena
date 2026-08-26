// Provisioning, treasury and social proofs.
//
// These modules touch keys, identity and public speech. The tests here cover
// the parts that must hold without a network: that provisioning is idempotent,
// that a private key can never leave through a "public" accessor, that the
// post queue cannot double-post, and that the treasury is never regenerated on
// top of a funded one.
//
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arena-ops-"));
process.env.DATA_DIR = tmp;
process.env.ENCRYPTION_KEY = "0".repeat(64);
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
process.env.ARENA_SOCIAL_ENABLED = "false";

const { provisionBots, publicBots, wakeableBots, getSystemUserId } = await import("./bot-provision");
const { ensureTreasury, getTreasury, treasuryLedger, recordTreasuryLedger, totalDisbursed } =
  await import("./treasury");
const { queuePost, getFeed, pendingPosts, flushPosts, socialEnabled } = await import("./bot-social");
const { getBot } = await import("./bot-nav");
const { BOT_ROSTER } = await import("./bots");

// ── Provisioning ───────────────────────────────────────────────────────────

test("provisioning creates the whole roster, then is a no-op", () => {
  const first = provisionBots();
  assert.equal(first.created.length, BOT_ROSTER.length, "every bot created on the first run");

  const second = provisionBots();
  assert.equal(second.created.length, 0, "nothing created the second time");
  assert.equal(second.updated.length, BOT_ROSTER.length, "all refreshed instead");
});

test("re-provisioning never changes a bot's wallet", () => {
  // Regenerating a wallet would strand its funds and orphan its whole trading
  // record behind an address nobody holds the key to.
  const before = publicBots().map((b) => `${b.slug}:${b.wallet}`);
  provisionBots();
  const after = publicBots().map((b) => `${b.slug}:${b.wallet}`);
  assert.deepEqual(after, before);
});

test("publicBots never exposes an encrypted key", () => {
  for (const b of publicBots()) {
    assert.ok(
      !("encrypted_key" in b),
      `${b.slug} leaked its key through the public accessor — this is the whole account`
    );
  }
});

test("model bots with no provider key are not wakeable; controls always are", () => {
  const wakeable = new Set(wakeableBots().map((b) => b.slug));
  // No provider keys are set in this test environment.
  for (const spec of BOT_ROSTER) {
    if (spec.kind === "control") {
      assert.ok(wakeable.has(spec.slug), `${spec.slug} is a control and must always run`);
    } else {
      assert.ok(
        !wakeable.has(spec.slug),
        `${spec.slug} has no key and must stay dark rather than trade badly`
      );
    }
  }
});

test("the house account exists and is stable", () => {
  const a = getSystemUserId();
  const b = getSystemUserId();
  assert.equal(a, b, "calling twice must not create a second house account");
});

// ── Treasury ───────────────────────────────────────────────────────────────

test("the treasury is created once and never regenerated", () => {
  const first = ensureTreasury();
  const second = ensureTreasury();
  assert.equal(second.wallet, first.wallet, "a second call must not mint a new wallet");
  assert.equal(getTreasury()?.wallet, first.wallet);
});

test("the treasury ledger records disbursements", () => {
  const before = totalDisbursed();
  recordTreasuryLedger({ kind: "seed", botId: null, lamports: 1_000_000, signature: "sig", detail: "t" });
  assert.equal(totalDisbursed(), before + 1_000_000);
  assert.equal(treasuryLedger(1)[0].kind, "seed");
});

// ── Social ─────────────────────────────────────────────────────────────────

test("posting is off unless explicitly enabled", () => {
  assert.equal(socialEnabled(), false, "transmission must never be the default");
});

test("the same event cannot be posted twice", () => {
  const bot = getBot("monkey")!;
  const a = queuePost({ bot, kind: "trade", text: "bought something at random", dedupeKey: "decision:1" });
  const b = queuePost({ bot, kind: "trade", text: "bought something at random", dedupeKey: "decision:1" });
  assert.equal(a.queued, true);
  assert.equal(b.queued, false, "a retry or restart must not double-post");
  assert.equal(a.id, b.id, "and it resolves to the same post");
});

test("an over-length post is refused, not truncated", () => {
  // Truncating would put words in a bot's mouth that it did not choose.
  const bot = getBot("index")!;
  assert.throws(
    () => queuePost({ bot, kind: "trade", text: "x".repeat(281), dedupeKey: "too-long" }),
    /over the 280/
  );
});

test("posts are recorded and readable even with X disabled", async () => {
  const bot = getBot("diamond")!;
  queuePost({ bot, kind: "milestone", text: "held everything, as always", dedupeKey: "m:1" });

  const feed = getFeed(bot.id);
  assert.equal(feed.length, 1, "the site shows it regardless of transmission");
  assert.equal(feed[0].posted_at, null, "but it is honestly marked as not transmitted");

  const result = await flushPosts();
  assert.equal(result.sent, 0);
  assert.match(result.reason ?? "", /ARENA_SOCIAL_ENABLED/);
  assert.ok(pendingPosts().length > 0, "and it stays queued rather than being dropped");
});
