// Take a consistent backup of the arena database.
//
// ── WHY NOT `cp arena.db backup.db` ────────────────────────────────────────
// Because it silently loses data, and this was reproduced rather than assumed:
// copying the .db file alone from a live arena produced a database with 11
// tables where the original had 16. Missing from the copy were `treasury`,
// `treasury_ledger`, `bot_wakes`, `bot_posts` and `scheduler_lock` — including
// the TREASURY WALLET KEY and one user's wallet.
//
// The reason is WAL. Recent commits live in `arena.db-wal` until a checkpoint
// folds them back into the main file, so a naive copy captures whatever
// happened to have been checkpointed and nothing since. `VACUUM INTO` is
// SQLite's own answer: it produces a single consistent file including
// everything in the WAL, safely, while the database is in use.
//
// What is in here is not replaceable. Bot and treasury private keys are
// AES-256-GCM blobs in this file, and the unit ledger — who owns what share of
// which bot — exists ONLY here. Positions can be read back off the chain; who
// they belong to cannot.
//
//   npm run backup                 -> ./backups/arena-<stamp>.db
//   npm run backup -- /path/dir    -> that directory instead
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

function main() {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  const source = path.join(dataDir, "arena.db");
  if (!fs.existsSync(source)) {
    console.error(`No database at ${source}`);
    process.exitCode = 1;
    return;
  }

  const outDir = process.argv[2] || path.join(process.cwd(), "backups");
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(outDir, `arena-${stamp}.db`);

  const db = new DatabaseSync(source);
  try {
    // VACUUM INTO refuses to overwrite, which is the behaviour we want: a
    // backup that clobbers a previous one on a name collision is not a backup.
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  // Prove the copy is complete rather than trusting it — this is the exact
  // check that caught the naive-cp problem.
  const check = new DatabaseSync(dest, { readOnly: true });
  const tables = (
    check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
  ).map((r) => r.name);
  const keys = (
    check.prepare("SELECT COUNT(*) AS n FROM bots WHERE encrypted_key != ''").get() as { n: number }
  ).n;
  const units = (
    check.prepare("SELECT COUNT(*) AS n FROM bot_units").get() as { n: number }
  ).n;
  check.close();

  const size = fs.statSync(dest).size;
  console.log(`backed up -> ${dest}`);
  console.log(`  ${(size / 1024 / 1024).toFixed(2)} MB · ${tables.length} tables`);
  console.log(`  ${keys} bot wallet keys · ${units} unit-ledger rows`);

  if (!tables.includes("treasury") || !tables.includes("bot_units")) {
    console.error("  WARNING: backup is missing core tables — do not rely on it");
    process.exitCode = 1;
    return;
  }
  console.log("\nENCRYPTION_KEY is NOT in this file. Back it up separately —");
  console.log("keeping both in one place means one breach takes both.");
}

main();
