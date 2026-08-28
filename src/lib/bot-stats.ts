// Realized trade statistics, replayed from the fill ledger.
//
// The two numbers that actually separate profitable wallets from losing ones
// (win rate and loss control — see TRADING-CRAFT.md) are exactly the numbers
// a leaderboard hides when it only shows returns. So they are computed here,
// from the same bot_trades rows the Solscan links prove, and published.
//
// Method: replay each bot's fills chronologically per mint with average-cost
// basis. A sell realizes PnL = proceeds − (avg cost × qty sold). No mark-to-
// market anywhere — open positions simply have not resolved yet, and saying
// so is more honest than guessing.
import { getDb } from "./db";

export type TradeStats = {
  closedTrades: number;
  wins: number;
  losses: number;
  /** wins / closed, null before anything closed. */
  winRate: number | null;
  /** Net realized PnL across all closed trades, lamports. */
  realizedLamports: number;
  bestLamports: number | null;
  worstLamports: number | null;
  /** Mean hours between first buy of a position and each realizing sell. */
  avgHoldHours: number | null;
};

type TradeRow = {
  ts: number;
  mint: string;
  side: string;
  lamports: number;
  qty: number;
};

export function botTradeStats(botId: number): TradeStats {
  const rows = getDb()
    .prepare(
      "SELECT ts, mint, side, lamports, qty FROM bot_trades WHERE bot_id = ? ORDER BY ts, id"
    )
    .all(botId) as TradeRow[];

  const book = new Map<string, { qty: number; costLamports: number; openedAt: number }>();
  let wins = 0;
  let losses = 0;
  let realized = 0;
  let best: number | null = null;
  let worst: number | null = null;
  let holdHoursSum = 0;
  let closed = 0;

  for (const t of rows) {
    if (t.side === "buy") {
      const p = book.get(t.mint);
      if (p) {
        p.qty += t.qty;
        p.costLamports += t.lamports;
      } else {
        book.set(t.mint, { qty: t.qty, costLamports: t.lamports, openedAt: t.ts });
      }
      continue;
    }

    // Sell. A fill with no recorded buy behind it (position predates the
    // ledger, forced withdrawal edge) cannot be scored honestly — skip it
    // rather than inventing a basis.
    const p = book.get(t.mint);
    if (!p || p.qty <= 0) continue;

    const soldQty = Math.min(t.qty, p.qty);
    const costOfSold = p.costLamports * (soldQty / p.qty);
    const pnl = t.lamports - costOfSold;

    realized += pnl;
    closed++;
    if (pnl >= 0) wins++;
    else losses++;
    best = best === null ? pnl : Math.max(best, pnl);
    worst = worst === null ? pnl : Math.min(worst, pnl);
    holdHoursSum += (t.ts - p.openedAt) / 3_600_000;

    p.qty -= soldQty;
    p.costLamports -= costOfSold;
    if (p.qty <= 1e-9) book.delete(t.mint);
  }

  return {
    closedTrades: closed,
    wins,
    losses,
    winRate: closed > 0 ? wins / closed : null,
    realizedLamports: realized,
    bestLamports: best,
    worstLamports: worst,
    avgHoldHours: closed > 0 ? holdHoursSum / closed : null,
  };
}

/** perf_index points for a small inline sparkline, oldest first. */
export function sparkline(botId: number, days = 7, maxPoints = 40): number[] {
  const since = Date.now() - days * 24 * 3_600_000;
  const rows = getDb()
    .prepare(
      "SELECT perf_index FROM bot_snapshots WHERE bot_id = ? AND ts >= ? ORDER BY ts"
    )
    .all(botId, since) as { perf_index: number }[];
  const values = rows.map((r) => r.perf_index);
  if (values.length <= maxPoints) return values;
  // Downsample evenly, always keeping the last point — the current value is
  // the one a sparkline exists to show.
  const step = (values.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => values[Math.round(i * step)]);
}

export type DecisionQuality = {
  /** Wake-ups that produced a decision (errors excluded). */
  decisions: number;
  /** Decisions where the bot chose to do nothing — cash IS a position. */
  holds: number;
  /** Actions the model proposed that the executor/safety/impact gate refused. */
  refused: number;
  /** Actions that survived validation and were attempted. */
  taken: number;
};

/**
 * Judgment quality, not just P&L. The default correct move most hours is to
 * HOLD CASH, and refusing junk (safety gate, price impact, dust) is a skill —
 * so a bot that holds and refuses well is doing its job even with few trades.
 * Read straight from the published decision record: actions stores {actions,
 * notes}, and a note with kept:false is a refusal.
 */
export function decisionQuality(botId: number): DecisionQuality {
  const rows = getDb()
    .prepare("SELECT actions FROM bot_decisions WHERE bot_id = ? AND error IS NULL")
    .all(botId) as { actions: string }[];
  let holds = 0;
  let refused = 0;
  let taken = 0;
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.actions) as {
        actions?: unknown[];
        notes?: { kept: boolean }[];
      };
      const kept = parsed.actions?.length ?? 0;
      taken += kept;
      if (kept === 0) holds++;
      refused += (parsed.notes ?? []).filter((n) => !n.kept).length;
    } catch {
      /* a malformed row is still a decision that happened */
    }
  }
  return { decisions: rows.length, holds, refused, taken };
}

export type Fill = {
  ts: number;
  slug: string;
  name: string;
  symbol: string;
  side: string;
  lamports: number;
};

/** The latest fills across the whole arena, for the ticker. */
export function latestFills(limit = 14): Fill[] {
  return getDb()
    .prepare(
      `SELECT t.ts, b.slug, b.name, t.symbol, t.side, t.lamports
       FROM bot_trades t JOIN bots b ON b.id = t.bot_id
       ORDER BY t.ts DESC LIMIT ?`
    )
    .all(limit) as Fill[];
}
