import { getAutomataFeed } from "@/lib/arena-feed";
import { buildEligibleList } from "@/lib/bot-universe";
import { getBotReturn, listBots, totalUnits } from "@/lib/bot-nav";
import { getPrices } from "@/lib/prices";
import { SOL_MINT } from "@/lib/wallets";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import { getDb } from "@/lib/db";
import { personaFor } from "@/lib/bot-persona";
import { botTradeStats, botAnalytics, sparkline, latestFills } from "@/lib/bot-stats";
import {
  Workspace,
  type BotCard,
  type TapeLine,
  type FeedLine,
  type HotToken,
} from "@/components/Workspace";

export const dynamic = "force-dynamic";

const DAY = 24 * 3600_000;

/**
 * The workspace desktop. The homepage is not a page you scroll — it is a
 * windowing terminal: live standings, activity, the tape, a hot-market panel
 * and an about panel, plus a bot dock. Click any model to open its book in a
 * draggable window. Server data refreshes underneath without disturbing the
 * windows.
 */
export default async function Home() {
  const bots = listBots();
  const db = getDb();

  const [eligible, prices] = await Promise.all([
    buildEligibleList().catch(() => []),
    getPrices([SOL_MINT]).catch(() => ({}) as Record<string, { usdPrice: number }>),
  ]);
  const solUsd = prices[SOL_MINT]?.usdPrice ?? null;

  const decisionCount = (db.prepare("SELECT COUNT(*) AS n FROM bot_decisions").get() as { n: number }).n;
  const tradeCount = (db.prepare("SELECT COUNT(*) AS n FROM bot_trades").get() as { n: number }).n;
  const openPositions = (
    db.prepare("SELECT COUNT(*) AS n FROM bot_holdings WHERE qty > 0").get() as { n: number }
  ).n;
  const backerCount = (
    db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM bot_units WHERE units > 0").get() as {
      n: number;
    }
  ).n;
  const posStmt = db.prepare("SELECT COUNT(*) AS n FROM bot_holdings WHERE bot_id = ? AND qty > 0");
  // Live wallet balance (as of the last wake) and the most recent published
  // decision — so the room shows what each model holds and what it's thinking,
  // trade or no trade.
  const balStmt = db.prepare(
    "SELECT sol_lamports FROM bot_snapshots WHERE bot_id = ? ORDER BY ts DESC, id DESC LIMIT 1"
  );
  const thoughtStmt = db.prepare(
    "SELECT rationale, actions, ts FROM bot_decisions WHERE bot_id = ? AND published_at IS NOT NULL ORDER BY ts DESC, id DESC LIMIT 1"
  );

  const cards: BotCard[] = bots.map((b) => {
    const persona = personaFor(b.slug);
    const stats = botTradeStats(b.id);
    const an = botAnalytics(b.id);
    const balRow = balStmt.get(b.id) as { sol_lamports: number } | undefined;
    const dRow = thoughtStmt.get(b.id) as
      | { rationale: string; actions: string; ts: number }
      | undefined;
    let lastAction: string | null = null;
    if (dRow) {
      try {
        const n = ((JSON.parse(dRow.actions || "{}").actions as unknown[]) ?? []).length;
        lastAction = n === 0 ? "held" : `${n} trade${n === 1 ? "" : "s"}`;
      } catch {
        /* leave null */
      }
    }
    return {
      solBalance: balRow ? balRow.sol_lamports / LAMPORTS_PER_SOL : null,
      lastThought: dRow?.rationale || null,
      lastThoughtTs: dRow?.ts ?? null,
      lastAction,
      slug: b.slug,
      name: b.name,
      model: b.kind === "control" ? "code control" : b.model,
      kind: b.kind,
      color: persona.color,
      d7: getBotReturn(b.id, 7 * DAY),
      d24h: getBotReturn(b.id, DAY),
      winRate: stats.winRate,
      realizedSol: stats.closedTrades > 0 ? stats.realizedLamports / LAMPORTS_PER_SOL : null,
      maxDrawdownPct: an.maxDrawdownPct,
      volumeSol: an.totalVolumeSol,
      tokens: an.uniqueTokens,
      streakKind: an.streakKind,
      streakLen: an.streakLen,
      positions: (posStmt.get(b.id) as { n: number }).n,
      backingSol: totalUnits(b.id) / LAMPORTS_PER_SOL,
      spark: sparkline(b.id),
    };
  });

  const tape: TapeLine[] = latestFills(40).map((f) => ({
    ts: f.ts,
    slug: f.slug,
    name: f.name,
    symbol: f.symbol,
    side: f.side,
    sol: f.lamports / LAMPORTS_PER_SOL,
  }));

  const feed: FeedLine[] = getAutomataFeed(60).map((it) => ({
    ts: it.ts,
    slug: it.botSlug,
    name: it.botName ?? "system",
    color: it.color,
    kind: it.kind,
    text: it.text,
  }));

  const hot: HotToken[] = eligible.slice(0, 14).map((t) => ({
    symbol: t.symbol,
    mint: t.mint,
    fresh: Boolean(t.fresh),
    vol1hUsd: t.vol1hUsd ?? null,
    change1h: t.change1h ?? null,
  }));

  const facts = {
    sol: solUsd,
    tradeable: eligible.length,
    decisions: decisionCount,
    fills: tradeCount,
    open: openPositions,
    backers: backerCount,
  };

  return <Workspace bots={cards} tape={tape} feed={feed} hot={hot} facts={facts} />;
}
