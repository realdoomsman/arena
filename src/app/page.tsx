import { buildEligibleList } from "@/lib/bot-universe";
import { getBotReturn, listBots, totalUnits } from "@/lib/bot-nav";
import { getPrices } from "@/lib/prices";
import { SOL_MINT } from "@/lib/wallets";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import { getDb } from "@/lib/db";
import { personaFor } from "@/lib/bot-persona";
import { botTradeStats, botAnalytics, sparkline, latestFills } from "@/lib/bot-stats";
import { Workspace, type BotCard, type TapeLine } from "@/components/Workspace";

export const dynamic = "force-dynamic";

const DAY = 24 * 3600_000;

/**
 * The workspace desktop. The homepage is not a page you scroll — it is a
 * windowing terminal: a live standings panel, the tape, and a bot dock. Click
 * any model to open its book in a draggable window. Server data refreshes
 * underneath without disturbing the windows.
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
  const posStmt = db.prepare("SELECT COUNT(*) AS n FROM bot_holdings WHERE bot_id = ? AND qty > 0");

  const cards: BotCard[] = bots.map((b) => {
    const persona = personaFor(b.slug);
    const stats = botTradeStats(b.id);
    const an = botAnalytics(b.id);
    return {
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

  const tape: TapeLine[] = latestFills(24).map((f) => ({
    ts: f.ts,
    slug: f.slug,
    name: f.name,
    symbol: f.symbol,
    side: f.side,
    sol: f.lamports / LAMPORTS_PER_SOL,
  }));

  const facts = {
    sol: solUsd,
    tradeable: eligible.length,
    decisions: decisionCount,
    fills: tradeCount,
    open: openPositions,
  };

  return <Workspace bots={cards} tape={tape} facts={facts} />;
}
