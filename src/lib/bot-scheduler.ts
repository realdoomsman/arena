// The clock.
//
// Every bot wakes once an hour, at its own minute. The stagger is not
// cosmetic: eleven bots reading the same feed and firing at :00 would pile
// into the same thin pool within seconds and front-run each other, making
// every bot look like a worse trader than it is. Five minutes apart, each one
// trades against a market the others have already finished moving.
//
// ── ONE PROCESS, ENFORCED ───────────────────────────────────────────────────
// Two schedulers would wake the same bot twice on one decision and the ledger
// would permanently disagree with the chain. The lock is a LEASE with a
// heartbeat rather than a boolean, so a process that dies holding it releases
// automatically instead of freezing the arena until someone notices.
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { runWake } from "./bot-engine";
import { wakeableBots } from "./bot-provision";
import { flushPosts } from "./bot-social";
import { reflectIfDue } from "./bot-memory";
import { isDraining } from "./inflight";
import { reconcileAll } from "./bot-reconcile";

const TICK_MS = 60_000;
/** Minute past the hour to re-check the books. Deliberately not :00, where
 *  every bot slot and every external feed is already busiest. */
const RECONCILE_MINUTE = 57;
/** A lease older than this is considered abandoned. */
const LEASE_TTL_MS = 5 * 60_000;
// randomUUID, not pid+seconds: in a container Node is routinely PID 1, so two
// replicas booting in the same second produced IDENTICAL holder strings — and
// then each one reads `row.holder === HOLDER`, concludes it already owns the
// lease, and both tick forever. That is worse than no lock at all.
const HOLDER = randomUUID();

declare global {
  // eslint-disable-next-line no-var
  var __aScheduler: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __aSchedulerBusy: boolean | undefined;
}

/** The hour a wake belongs to. Used to make each bot's hourly run idempotent. */
function hourKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}`;
}

/**
 * Take or renew the lease. Returns false when another live process holds it.
 */
export function acquireLock(): boolean {
  const db = getDb();
  const now = Date.now();
  // ONE conditional statement rather than SELECT-then-UPDATE. The read/write
  // pair let two processes both see an expired lease, both write, and both
  // return true. Taking the lock only when the UPDATE actually matched a row
  // makes the decision atomic in SQLite itself.
  db.prepare("INSERT OR IGNORE INTO scheduler_lock (id, holder, heartbeat_at) VALUES (1, ?, ?)").run(
    HOLDER,
    now
  );
  const res = db
    .prepare(
      `UPDATE scheduler_lock SET holder = ?, heartbeat_at = ?
       WHERE id = 1 AND (holder = ? OR heartbeat_at <= ?)`
    )
    .run(HOLDER, now, HOLDER, now - LEASE_TTL_MS);
  return Number(res.changes) === 1;
}

export function releaseLock(): void {
  getDb().prepare("DELETE FROM scheduler_lock WHERE id = 1 AND holder = ?").run(HOLDER);
}

export type TickResult = { woke: string[]; skipped: number; locked: boolean };

/**
 * One minute of arena time.
 *
 * Wakes only the bots whose slot is this minute and which have not already run
 * this hour. The hour_key row is written BEFORE the wake, so a crash
 * mid-decision does not cause a re-run on restart — a duplicate trade is a
 * far worse outcome than a missed hour.
 */
export async function tick(now = new Date()): Promise<TickResult> {
  // Shutdown has begun: finish what is in flight, start nothing new. Waking a
  // bot now would open a swap the process will not live long enough to record.
  if (isDraining()) return { woke: [], skipped: 0, locked: true };
  if (!acquireLock()) return { woke: [], skipped: 0, locked: true };

  const db = getDb();
  const minute = now.getUTCMinutes();
  const key = hourKey(now);
  const woke: string[] = [];
  let skipped = 0;

  // A bot is due if its minute has ARRIVED OR PASSED this hour and it has not
  // run yet. Matching `slot === minute` exactly meant a single missed tick — a
  // slow previous tick, a restart, a paused VM — silently cost that bot its
  // whole hour, with nothing anywhere recording that it had been skipped.
  //
  // But catching up on everything at once would fire the whole backlog inside
  // one tick and destroy the five-minute stagger that stops the fleet piling
  // into the same thin pool. So: every bot whose minute is exactly now, plus
  // AT MOST ONE that is overdue.
  const pending = wakeableBots().filter((b) => {
    if (b.slot > minute) return false;
    const already = db
      .prepare("SELECT 1 FROM bot_wakes WHERE bot_id = ? AND hour_key = ?")
      .get(b.id, key);
    if (already) skipped++;
    return !already;
  });

  const onTime = pending.filter((b) => b.slot === minute);
  const overdue = pending.filter((b) => b.slot < minute).slice(0, 1);

  for (const bot of [...onTime, ...overdue]) {
    db.prepare("INSERT INTO bot_wakes (bot_id, hour_key, ran_at) VALUES (?, ?, ?)").run(
      bot.id,
      key,
      Date.now()
    );

    try {
      const result = await runWake(bot.id);
      db.prepare("UPDATE bot_wakes SET decision_id = ?, error = ? WHERE bot_id = ? AND hour_key = ?").run(
        result.decisionId,
        result.error,
        bot.id,
        key
      );
      woke.push(`${bot.slug}${result.error ? ` (${result.error})` : ` +${result.executed}`}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      db.prepare("UPDATE bot_wakes SET error = ? WHERE bot_id = ? AND hour_key = ?").run(msg, bot.id, key);
      console.error(`[scheduler] ${bot.slug} wake threw:`, msg);
      woke.push(`${bot.slug} (threw: ${msg})`);
    }

    await reflectIfDue(bot).catch((e) => console.error(`[scheduler] ${bot.slug} reflection:`, e));
  }

  // Speaking is best-effort and never blocks trading.
  await flushPosts().catch((e) => console.error("[scheduler] post flush:", e));

  // Reconcile hourly rather than only at boot. A process that stays up for
  // weeks would otherwise never re-check the books after the one time it
  // looked — and the window this catches is opened by kills that do not
  // trigger a restart anyone notices.
  if (now.getUTCMinutes() === RECONCILE_MINUTE) {
    await reconcileAll().catch((e) => console.error("[scheduler] reconcile:", e));
  }

  return { woke, skipped, locked: false };
}

/**
 * Start the loop. Safe to call repeatedly — only one interval is ever armed
 * per process, and only one process ever holds the lease.
 */
export function ensureScheduler(): void {
  if (globalThis.__aScheduler) return;
  if (process.env.ARENA_SCHEDULER_ENABLED !== "true") {
    console.log("[scheduler] disabled (set ARENA_SCHEDULER_ENABLED=true to run bots)");
    return;
  }

  globalThis.__aScheduler = setInterval(() => {
    // A slow tick must never overlap itself: overlapping ticks could both pass
    // the hour_key check before either writes it.
    if (globalThis.__aSchedulerBusy) return;
    globalThis.__aSchedulerBusy = true;
    void tick()
      .then((r) => {
        if (r.woke.length) console.log(`[scheduler] woke ${r.woke.join(", ")}`);
      })
      .catch((e) => console.error("[scheduler] tick failed:", e))
      .finally(() => {
        globalThis.__aSchedulerBusy = false;
      });
  }, TICK_MS);

  console.log("[scheduler] armed — one tick per minute");
}
