// One-time reconciliation for bots that were funded by a DIRECT on-chain
// transfer (SOL sent straight to the wallet) rather than through the treasury
// seed. That path never recorded a flow, so the unit ledger shows the bot as
// holding 0 units — which reads on /status as "bots funded: none" and makes the
// bot un-backable (unit price undefined).
//
// This adopts each such bot's CURRENT on-chain value as the house's genesis
// units, at genesis price. It moves NO money and writes NO snapshots — so it
// cannot double-count NAV and cannot disturb perf_index. After it runs, the
// house owns units worth exactly the bot's current NAV, unit price is defined,
// and the bot can take deposits correctly.
//
// Only touches bots with 0 units. Idempotent. DRY RUN by default.
//   npm run reconcile-adopt              # show what it would do
//   npm run reconcile-adopt -- --confirm # write it
import { getDb } from "../src/lib/db";
import { listBots, getBotNav, totalUnits, unitsForDeposit } from "../src/lib/bot-nav";
import { getSystemUserId } from "../src/lib/bot-provision";
import { GENESIS_UNIT_PRICE } from "../src/lib/bots";
import { LAMPORTS_PER_SOL } from "../src/lib/accounts";

const confirm = process.argv.includes("--confirm");
const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(4);

async function main() {
  const db = getDb();
  const houseId = getSystemUserId();
  const targets = listBots(true).filter((b) => totalUnits(b.id) === 0);

  if (targets.length === 0) {
    console.log("Every bot already holds units — nothing to adopt.");
    return;
  }

  console.log(`Adopting ${targets.length} directly-funded bot(s) as house genesis (price ${GENESIS_UNIT_PRICE}):\n`);
  let wrote = 0;
  for (const b of targets) {
    const nav = await getBotNav(b);
    if (!nav) {
      console.log(`  ${b.slug.padEnd(10)} SKIP — NAV unpriceable (a held position has no live price)`);
      continue;
    }
    if (!(nav.navLamports > 0)) {
      console.log(`  ${b.slug.padEnd(10)} SKIP — empty wallet (nothing to adopt)`);
      continue;
    }
    const units = unitsForDeposit(nav, nav.navLamports); // navLamports / GENESIS_UNIT_PRICE
    console.log(
      `  ${b.slug.padEnd(10)} NAV ${sol(nav.navLamports)} SOL` +
        `  ->  mint ${Math.round(units).toLocaleString()} house units`
    );
    if (!confirm) continue;

    const ts = Date.now();
    db.exec("BEGIN IMMEDIATE");
    try {
      // The flow record (no on-chain signature of its own: this is a bookkeeping
      // genesis, not a transfer). nav_before = the value being adopted; at
      // genesis price units * unit_price === lamports, so the book is consistent.
      db.prepare(
        `INSERT INTO bot_flows (bot_id, user_id, ts, kind, lamports, units, nav_before, unit_price, signature)
         VALUES (?, ?, ?, 'seed', ?, ?, ?, ?, NULL)`
      ).run(b.id, houseId, ts, Math.round(nav.navLamports), units, nav.navLamports, GENESIS_UNIT_PRICE);
      // Mint the units to the house.
      db.prepare(
        `INSERT INTO bot_units (user_id, bot_id, units, cost_lamports)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, bot_id) DO UPDATE SET
           units = units + excluded.units,
           cost_lamports = MAX(0, cost_lamports + excluded.cost_lamports)`
      ).run(houseId, b.id, units, Math.round(nav.navLamports));
      db.exec("COMMIT");
      wrote++;
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* not in a tx */
      }
      console.log(`     FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!confirm) {
    console.log("\nDRY RUN — re-run with --confirm to write the ledger.");
  } else {
    console.log(`\nDone: adopted ${wrote} bot(s). Check /status — "bots funded" should be green.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
