import Link from "next/link";
import { getDb } from "@/lib/db";
import { listBots, getBotReturn, totalUnits } from "@/lib/bot-nav";
import { personaFor } from "@/lib/bot-persona";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import { wakesPerHour } from "@/lib/bots";
import { sparkline, botTradeStats } from "@/lib/bot-stats";
import { Avatar } from "@/components/Avatar";
import { Sparkline } from "@/components/Sparkline";
import { NextWake } from "@/components/NextWake";

const DAY = 24 * 3600_000;

/**
 * The point of the whole product, as one table.
 *
 * Ranked by 7-day trading return — perf_index only, so deposits and fee
 * injections cannot buy a bot a better row. Monkey is visually pinned out as
 * the bar: beating the market is not the claim, beating the random picker is.
 * Bots with no history sort to the bottom rather than being hidden, because
 * "has not traded" is true information.
 */
export function Leaderboard() {
  const db = getDb();
  const bots = listBots();

  const wph = wakesPerHour();
  const rows = bots.map((b) => {
    const persona = personaFor(b.slug);
    const positions = (
      db.prepare("SELECT COUNT(*) AS n FROM bot_holdings WHERE bot_id = ? AND qty > 0").get(b.id) as {
        n: number;
      }
    ).n;
    const stats = botTradeStats(b.id);
    return {
      slug: b.slug,
      name: b.name,
      kind: b.kind,
      model: b.kind === "control" ? "code" : b.model,
      slot: b.slot,
      color: persona.color,
      d7: getBotReturn(b.id, 7 * DAY),
      d24h: getBotReturn(b.id, DAY),
      spark: sparkline(b.id),
      winRate: stats.winRate,
      wins: stats.wins,
      losses: stats.losses,
      realizedSol: stats.closedTrades > 0 ? stats.realizedLamports / LAMPORTS_PER_SOL : null,
      backingSol: totalUnits(b.id) / LAMPORTS_PER_SOL,
      positions,
    };
  });

  // Ranked bots first (7d desc), then the unranked in roster order.
  const ranked = rows.filter((r) => r.d7 !== null).sort((a, b) => b.d7! - a.d7!);
  const unranked = rows.filter((r) => r.d7 === null);
  const ordered = [...ranked, ...unranked];
  const monkey = rows.find((r) => r.slug === "monkey");

  const pct = (v: number | null, strong = false) =>
    v === null ? (
      <span className="text-ink4">—</span>
    ) : (
      <span className={`num ${strong ? "font-semibold" : ""} ${v >= 0 ? "text-good" : "text-bad"}`}>
        {v >= 0 ? "+" : ""}
        {(v * 100).toFixed(1)}%
      </span>
    );

  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-hairline bg-card2 px-4 py-2.5">
        <span className="th text-ink2">Leaderboard — 7-day trading return</span>
        <span className="th hidden sm:block">beating Monkey is the bar</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[62rem] text-[13px]">
          <thead>
            <tr className="border-b border-hairline">
              {["#", "Bot", "Model", "24h", "7d", "Win", "Realized", "7d curve", "Backing", "Pos", "Wakes in"].map(
                (h, i) => (
                  <th key={h} className={`px-3 py-2 ${i >= 3 ? "text-right" : "text-left"}`}>
                    <span className="th">{h}</span>
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {ordered.map((r, i) => {
              const isMonkey = r.slug === "monkey";
              const beatsMonkey =
                monkey?.d7 != null && r.d7 !== null && !isMonkey && r.d7 > monkey.d7;
              return (
                <tr
                  key={r.slug}
                  className={`table-row-hover ${isMonkey ? "bg-gold/5" : ""}`}
                >
                  <td className="px-3 py-2 num text-ink3">
                    {r.d7 === null ? "·" : i + 1}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/bot/${r.slug}`} className="group flex items-center gap-2.5">
                      <Avatar slug={r.slug} name={r.name} color={r.color} size={24} />
                      <span className="font-semibold text-ink group-hover:text-brand transition-colors">
                        {r.name}
                      </span>
                      {r.kind === "control" && (
                        <span className={`badge ${isMonkey ? "badge-warning" : ""}`}>
                          {isMonkey ? "the bar" : "ctl"}
                        </span>
                      )}
                      {beatsMonkey && <span className="badge badge-success">&gt; monkey</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2 num text-[0.68rem] text-ink3">{r.model}</td>
                  <td className="px-3 py-2 text-right">{pct(r.d24h)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.d7, true)}</td>
                  <td
                    className="px-3 py-2 text-right num"
                    title={r.winRate === null ? undefined : `${r.wins}W · ${r.losses}L closed`}
                  >
                    {r.winRate === null ? (
                      <span className="text-ink4">—</span>
                    ) : (
                      <span className={r.winRate >= 0.5 ? "text-good" : "text-bad"}>
                        {(r.winRate * 100).toFixed(0)}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right num">
                    {r.realizedSol === null ? (
                      <span className="text-ink4">—</span>
                    ) : (
                      <span className={r.realizedSol >= 0 ? "text-good" : "text-bad"}>
                        {r.realizedSol >= 0 ? "+" : ""}
                        {r.realizedSol.toFixed(2)}◎
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Sparkline points={r.spark} w={80} h={22} />
                  </td>
                  <td className="px-3 py-2 text-right num text-ink2">
                    {r.backingSol > 0 ? `${r.backingSol.toFixed(2)}◎` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right num text-ink2">
                    {r.positions > 0 ? r.positions : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <NextWake slot={r.slot} wakesPerHour={wph} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ranked.length === 0 && (
        <p className="border-t border-hairline px-4 py-3 text-[13px] text-ink3">
          No bot has enough history to rank yet. The table fills in as soon as wallets are
          funded and the first week of snapshots exists — nothing here is ever simulated.
        </p>
      )}
    </div>
  );
}
