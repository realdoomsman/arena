// Does the ledger still agree with the chain?
//
// Every other safeguard in this codebase reduces the CHANCE of divergence:
// confirmed sends, critical sections, a drain on shutdown, re-checking a
// timed-out confirmation by signature. None of them can reduce it to zero,
// because SIGKILL, an OOM kill and a host losing power do not run cleanup.
//
// So this is the backstop that makes the remaining window DETECTABLE rather
// than merely unlikely. It walks each bot wallet's recent on-chain signatures
// and diffs them against bot_trades. A signature the chain knows about and the
// ledger does not is a real trade that never got recorded — the exact failure
// that leaves pooled user capital mis-attributed, and previously the exact
// failure nobody would ever have noticed.
//
// It deliberately does NOT repair automatically. Writing a guessed trade row
// from a signature we cannot fully decode would replace a detectable problem
// with an invented one. It reports; a human decides.
import { getDb } from "./db";
import { listBots, type BotRow } from "./bot-nav";
import { rpcUrl } from "./swap";

export type Divergence = {
  botSlug: string;
  signature: string;
  blockTime: number | null;
  reason: "on-chain but not in ledger";
};

export type ReconcileReport = {
  checkedBots: number;
  checkedSignatures: number;
  divergences: Divergence[];
  /** Wallets the RPC could not be read for — unknown, not clean. */
  unreachable: string[];
  ts: number;
};

declare global {
   
  var __aReconcile: ReconcileReport | undefined;
}

/** Signatures the wallet has recently been involved in, newest first. */
async function recentSignatures(
  wallet: string,
  limit: number
): Promise<{ signature: string; blockTime: number | null; err: unknown }[] | null> {
  try {
    const res = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [wallet, { limit }],
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: { signature: string; blockTime: number | null; err: unknown }[];
    };
    return data.result ?? null;
  } catch {
    return null;
  }
}

/**
 * Compare one bot's chain history against its ledger.
 *
 * Only signatures the chain reports as SUCCESSFUL are considered: a failed
 * transaction moved no funds, so its absence from the ledger is correct.
 *
 * Funding transfers (seed, deposits, fee injections) legitimately appear
 * on-chain without a bot_trades row, so bot_flows signatures count as known
 * too — otherwise every seeded bot would report a false divergence on day one.
 */
export async function reconcileBot(
  bot: BotRow,
  limit = 50
): Promise<{ divergences: Divergence[]; checked: number; reachable: boolean }> {
  const sigs = await recentSignatures(bot.wallet, limit);
  if (!sigs) return { divergences: [], checked: 0, reachable: false };

  const db = getDb();
  const known = new Set<string>();
  for (const r of db
    .prepare("SELECT signature FROM bot_trades WHERE bot_id = ?")
    .all(bot.id) as { signature: string }[]) {
    known.add(r.signature);
  }
  for (const r of db
    .prepare("SELECT signature FROM bot_flows WHERE bot_id = ? AND signature IS NOT NULL")
    .all(bot.id) as { signature: string }[]) {
    known.add(r.signature);
  }

  const divergences: Divergence[] = [];
  for (const s of sigs) {
    if (s.err) continue; // failed on-chain: moved nothing, correctly absent
    if (known.has(s.signature)) continue;
    divergences.push({
      botSlug: bot.slug,
      signature: s.signature,
      blockTime: s.blockTime,
      reason: "on-chain but not in ledger",
    });
  }
  return { divergences, checked: sigs.length, reachable: true };
}

/** Reconcile the whole roster. Cheap enough to run at boot and hourly. */
export async function reconcileAll(): Promise<ReconcileReport> {
  const bots = listBots();
  const report: ReconcileReport = {
    checkedBots: 0,
    checkedSignatures: 0,
    divergences: [],
    unreachable: [],
    ts: Date.now(),
  };

  for (const bot of bots) {
    const r = await reconcileBot(bot);
    if (!r.reachable) {
      // An unreadable wallet is UNKNOWN, not clean. Reporting it as clean is
      // how a monitoring system learns to lie.
      report.unreachable.push(bot.slug);
      continue;
    }
    report.checkedBots++;
    report.checkedSignatures += r.checked;
    report.divergences.push(...r.divergences);
  }

  if (report.divergences.length > 0) {
    console.error(
      `[reconcile] ${report.divergences.length} on-chain transaction(s) missing from the ledger:`,
      report.divergences.map((d) => `${d.botSlug}:${d.signature.slice(0, 12)}…`).join(", ")
    );
  }

  globalThis.__aReconcile = report;
  return report;
}

/** The last report, for /status. Null until one has run. */
export function lastReconcile(): ReconcileReport | null {
  return globalThis.__aReconcile ?? null;
}

/**
 * Wakes that started and never finished.
 *
 * bot_wakes rows are inserted BEFORE runWake and updated after, so a row with
 * neither a decision nor an error is a wake the process died in the middle of.
 * The state was always distinguishable — nothing ever asked. Each one is an
 * hour a bot lost, and a place a swap may have landed without being recorded,
 * so it is the first thing reconciliation should be pointed at.
 */
export function crashedWakes(limit = 20): { slug: string; hourKey: string; ranAt: number }[] {
  return getDb()
    .prepare(
      `SELECT b.slug, w.hour_key AS hourKey, w.ran_at AS ranAt
       FROM bot_wakes w JOIN bots b ON b.id = w.bot_id
       WHERE w.decision_id IS NULL AND w.error IS NULL
       ORDER BY w.ran_at DESC LIMIT ?`
    )
    .all(limit) as { slug: string; hourKey: string; ranAt: number }[];
}

/**
 * Has the arena gone quiet?
 *
 * The failure nobody notices is not a crash — it is eleven bots silently
 * doing nothing for days because a provider key expired, a rate limit stuck,
 * or the scheduler died in a way that still serves web pages. A crash is
 * loud; silence is not, and silence is indistinguishable from "every bot
 * decided to hold" unless something is watching the clock.
 */
export function staleness(): { lastDecisionTs: number | null; hoursQuiet: number | null } {
  const row = getDb().prepare("SELECT MAX(ts) AS ts FROM bot_decisions").get() as {
    ts: number | null;
  };
  if (!row.ts) return { lastDecisionTs: null, hoursQuiet: null };
  return { lastDecisionTs: row.ts, hoursQuiet: (Date.now() - row.ts) / 3_600_000 };
}
