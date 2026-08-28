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
import { autoDistributeFromTreasury, autoInjectEnabled, autoInjectIntervalMin } from "./bot-funding";
import { claimCreatorFees, creatorClaimEnabled, creatorClaimIntervalMin } from "./bot-fees-claim";

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

  var __aScheduler: ReturnType<typeof setInterval> | undefined;

  var __aSchedulerBusy: boolean | undefined;

  var __aLastAutoInject: number | undefined;

  var __aLastCreatorClaim: number | undefined;
}

/** The hour a wake belongs to. Used to make each bot's hourly run idempotent. */
function hourKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}`;
}

import { wakesPerHour } from "./bots";
export { wakesPerHour };

/**
 * The idempotency key for one scheduled wake. At one wake per hour it stays
 * the plain hour key (so history and in-flight rows keep their meaning); at
 * higher cadences the scheduled minute joins it, one key per grid slot.
 */
function wakeKey(key: string, scheduledMinute: number, wph: number): string {
  return wph === 1 ? key : `${key}:${String(scheduledMinute).padStart(2, "0")}`;
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

  // A bot is due if a scheduled minute has ARRIVED OR PASSED this hour and
  // that wake has not run yet. Matching the minute exactly meant a single
  // missed tick — a slow previous tick, a restart, a paused VM — silently cost
  // that bot its whole slot, with nothing anywhere recording the skip.
  //
  // But catching up on everything at once would fire the whole backlog inside
  // one tick and destroy the stagger that stops the fleet piling into the same
  // thin pool. So: every wake whose minute is exactly now, plus AT MOST ONE
  // that is overdue.
  //
  // At ARENA_WAKES_PER_HOUR > 1 each bot's schedule is `slot mod interval`,
  // repeating every `interval` minutes — the stagger survives, compressed.
  const wph = wakesPerHour();
  const interval = 60 / wph;

  type Due = { bot: ReturnType<typeof wakeableBots>[number]; scheduledMinute: number };
  const onTime: Due[] = [];
  const overdueCandidates: Due[] = [];
  for (const b of wakeableBots()) {
    const base = b.slot % interval;
    for (let m = base; m <= minute; m += interval) {
      const already = db
        .prepare("SELECT 1 FROM bot_wakes WHERE bot_id = ? AND hour_key = ?")
        .get(b.id, wakeKey(key, m, wph));
      if (already) {
        skipped++;
        continue;
      }
      if (m === minute) onTime.push({ bot: b, scheduledMinute: m });
      else overdueCandidates.push({ bot: b, scheduledMinute: m });
    }
  }
  // For an overdue bot, run only its LATEST missed slot — replaying every
  // missed decision against the current market would be trading the past.
  const latestMissed = new Map<number, Due>();
  for (const d of overdueCandidates) {
    const prev = latestMissed.get(d.bot.id);
    if (!prev || d.scheduledMinute > prev.scheduledMinute) latestMissed.set(d.bot.id, d);
  }
  const overdue = [...latestMissed.values()].slice(0, 1);

  for (const { bot, scheduledMinute } of [...onTime, ...overdue]) {
    // Renew the lease before EACH wake. One tick can hold several wakes, each
    // a model call plus on-chain swaps — long enough to outlive the 5-minute
    // TTL, at which point another process would take the lease and the same
    // bot could wake twice. Losing the lease mid-tick means stop starting
    // wakes, immediately.
    if (!acquireLock()) {
      console.warn("[scheduler] lease lost mid-tick — starting no further wakes");
      break;
    }

    const wk = wakeKey(key, scheduledMinute, wph);
    db.prepare("INSERT INTO bot_wakes (bot_id, hour_key, ran_at) VALUES (?, ?, ?)").run(
      bot.id,
      wk,
      Date.now()
    );

    try {
      const result = await runWake(bot.id);
      db.prepare("UPDATE bot_wakes SET decision_id = ?, error = ? WHERE bot_id = ? AND hour_key = ?").run(
        result.decisionId,
        result.error,
        bot.id,
        wk
      );
      woke.push(`${bot.slug}${result.error ? ` (${result.error})` : ` +${result.executed}`}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      db.prepare("UPDATE bot_wakes SET error = ? WHERE bot_id = ? AND hour_key = ?").run(msg, bot.id, wk);
      console.error(`[scheduler] ${bot.slug} wake threw:`, msg);
      woke.push(`${bot.slug} (threw: ${msg})`);
    }

    await reflectIfDue(bot).catch((e) => console.error(`[scheduler] ${bot.slug} reflection:`, e));

    // Answer backer notes on the same clock as everything else. Best-effort:
    // a failed reply leaves the note unanswered for the next wake, never
    // blocks trading.
    const { reviewNotes } = await import("./bot-notes");
    await reviewNotes(bot).catch((e) => console.error(`[scheduler] ${bot.slug} notes:`, e));
  }

  // Speaking is best-effort and never blocks trading.
  await flushPosts().catch((e) => console.error("[scheduler] post flush:", e));

  // Sweep creator-fee revenue from the treasury into the bots, on its own
  // interval. Runs only here, under the single scheduler lease, so it can never
  // double-distribute. Opt-in and best-effort — a failed sweep never blocks a
  // wake, and the surplus simply waits in the treasury for the next tick.
  if (autoInjectEnabled()) {
    const last = globalThis.__aLastAutoInject ?? 0;
    if (now.getTime() - last >= autoInjectIntervalMin() * 60_000) {
      globalThis.__aLastAutoInject = now.getTime();
      await autoDistributeFromTreasury().catch((e) =>
        console.error("[scheduler] auto fee distribution:", e)
      );
    }
  }

  // Claim pump.fun creator rewards into the bots, on its own interval. One
  // permissionless crank pays every recipient its share; we book each bot's
  // delta as a fee_injection. Runs only here, under the single lease, so it
  // never double-claims. Opt-in and best-effort — a failed claim never blocks
  // a wake; the fees wait in the program for the next crank.
  if (creatorClaimEnabled()) {
    const last = globalThis.__aLastCreatorClaim ?? 0;
    if (now.getTime() - last >= creatorClaimIntervalMin() * 60_000) {
      globalThis.__aLastCreatorClaim = now.getTime();
      await claimCreatorFees().catch((e) => console.error("[scheduler] creator-fee claim:", e));
    }
  }

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
