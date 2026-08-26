// Ledger proof for the pooled bot accounting.
//
// This runs the exact worked example from the build plan, plus the cases that
// are easy to get subtly wrong and expensive to discover on-chain: a fee
// injection must lift what a unit is WORTH without moving what the model
// EARNED, and a deposit must never register as a gain.
//
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Point the DB at a throwaway directory BEFORE anything imports it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "basket-bots-"));
process.env.DATA_DIR = tmp;
process.env.ENCRYPTION_KEY = "0".repeat(64);

const { getDb } = await import("./db");
const { recordFlow, writeSnapshot, unitsForDeposit, lamportsForUnits, totalUnits, getBotReturn } =
  await import("./bot-nav");
const { LAMPORTS_PER_SOL } = await import("./accounts");

const SOL = LAMPORTS_PER_SOL;

/** Real user rows — bot_units carries a FK to users, and it is enforced. */
function makeUser(n: number): number {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(`u${n}`) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  db.prepare(
    "INSERT INTO users (email, username, pass_hash, created_at) VALUES (?, ?, '', ?)"
  ).run(`u${n}@test.local`, `u${n}`, Date.now());
  return (db.prepare("SELECT id FROM users WHERE username = ?").get(`u${n}`) as { id: number }).id;
}

function makeBot(slug: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO bots (slug, name, provider, model, kind, tagline, system_prompt, wallet, encrypted_key, enabled, slot, created_at)
     VALUES (?, ?, 'none', '', 'control', '', '', ?, '', 1, 0, ?)`
  ).run(slug, slug, `wallet-${slug}`, Date.now());
  return db.prepare("SELECT * FROM bots WHERE slug = ?").get(slug) as never;
}

/** A NAV object as the engine would compute it, without touching the network. */
function nav(bot: { id: number }, lamports: number) {
  const units = totalUnits(bot.id);
  return {
    navLamports: lamports,
    solLamports: lamports,
    positionsLamports: 0,
    units,
    navPerUnit: units > 0 ? lamports / units : 1,
    holdings: [],
  };
}

test("the worked example: seed 1, invest 2, double, withdraw 4", () => {
  const bot = makeBot("grok-test") as { id: number };
  const HOUSE = makeUser(1);
  const BACKER = makeUser(2);

  // 1. House seeds 1 SOL at genesis price of 1 lamport per unit.
  const seedUnits = unitsForDeposit(nav(bot, 0), 1 * SOL);
  recordFlow({ bot: bot as never, nav: nav(bot, 0), userId: HOUSE, kind: "seed", lamports: 1 * SOL, units: seedUnits });
  assert.equal(totalUnits(bot.id), 1 * SOL, "seed mints one unit per lamport");

  // 2. A backer puts in 2 SOL while the unit price is still 1.
  const n1 = nav(bot, 1 * SOL);
  assert.equal(n1.navPerUnit, 1, "unit price starts at 1");
  const backerUnits = unitsForDeposit(n1, 2 * SOL);
  recordFlow({ bot: bot as never, nav: n1, userId: BACKER, kind: "deposit", lamports: 2 * SOL, units: backerUnits });

  // 3. The bot is now trading a 3 SOL book.
  const n2 = nav(bot, 3 * SOL);
  assert.equal(n2.navLamports, 3 * SOL, "bot trades the pooled 3 SOL");
  assert.equal(n2.navPerUnit, 1, "a deposit at fair value does not move the unit price");

  // 4. It doubles the book to 6 SOL. Nobody's units changed; each is worth 2x.
  const n3 = nav(bot, 6 * SOL);
  writeSnapshot(bot as never, n3);
  assert.equal(n3.navPerUnit, 2, "doubling the book doubles the unit price");

  // 5. The backer burns their units and exits.
  const owed = lamportsForUnits(n3, backerUnits);
  assert.equal(owed, 4 * SOL, "2 of 3 units out of a doubled 6 SOL book is 4 SOL");
  recordFlow({ bot: bot as never, nav: n3, userId: BACKER, kind: "withdraw", lamports: -owed, units: -backerUnits });

  // 6. The house keeps its single unit, still worth 2 SOL.
  const n4 = nav(bot, 2 * SOL);
  assert.equal(totalUnits(bot.id), 1 * SOL, "only the house's units remain");
  assert.equal(n4.navPerUnit, 2, "the exit did not dilute the holder who stayed");
});

test("a fee injection lifts unit value but NOT trading performance", () => {
  const bot = makeBot("opus-test") as { id: number };

  const seedUnits = unitsForDeposit(nav(bot, 0), 1 * SOL);
  recordFlow({ bot: bot as never, nav: nav(bot, 0), userId: makeUser(1), kind: "seed", lamports: 1 * SOL, units: seedUnits });

  // The bot trades flat — genuinely earns nothing.
  writeSnapshot(bot as never, nav(bot, 1 * SOL));
  const perfBefore = getBotReturn(bot.id, 60 * 60 * 1000);

  // Creator fees inject 1 SOL. No units are minted.
  recordFlow({
    bot: bot as never,
    nav: nav(bot, 1 * SOL),
    userId: null,
    kind: "fee_injection",
    lamports: 1 * SOL,
    units: 0,
  });

  const after = nav(bot, 2 * SOL);
  assert.equal(totalUnits(bot.id), 1 * SOL, "an injection mints no units");
  assert.equal(after.navPerUnit, 2, "so every existing unit is worth double");

  const perfAfter = getBotReturn(bot.id, 60 * 60 * 1000);
  assert.equal(
    perfAfter,
    perfBefore,
    "but the model earned nothing, and the leaderboard must say so"
  );
});

test("an injection cannot mint units", () => {
  const bot = makeBot("guard-test") as { id: number };
  assert.throws(
    () =>
      recordFlow({
        bot: bot as never,
        nav: nav(bot, 0),
        userId: null,
        kind: "fee_injection",
        lamports: 1 * SOL,
        units: 5,
      }),
    /never mint units/
  );
});

test("deposits and withdrawals do not register as trading returns", () => {
  const bot = makeBot("flow-test") as { id: number };

  const seedUnits = unitsForDeposit(nav(bot, 0), 1 * SOL);
  recordFlow({ bot: bot as never, nav: nav(bot, 0), userId: makeUser(1), kind: "seed", lamports: 1 * SOL, units: seedUnits });
  writeSnapshot(bot as never, nav(bot, 1 * SOL));

  // Ten separate backers pile in. The wallet balance grows 11x.
  for (let i = 0; i < 10; i++) {
    const n = nav(bot, (1 + i) * SOL);
    recordFlow({
      bot: bot as never,
      nav: n,
      userId: makeUser(100 + i),
      kind: "deposit",
      lamports: 1 * SOL,
      units: unitsForDeposit(n, 1 * SOL),
    });
  }

  const ret = getBotReturn(bot.id, 60 * 60 * 1000);
  assert.ok(
    ret !== null && Math.abs(ret) < 1e-9,
    `balance went 1 SOL -> 11 SOL on deposits alone, so trading return must be ~0, got ${ret}`
  );
});
