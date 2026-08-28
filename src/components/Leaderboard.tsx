import Link from "next/link";
import { getDb } from "@/lib/db";
import { listBots, getBotReturn, totalUnits } from "@/lib/bot-nav";
import { personaFor } from "@/lib/bot-persona";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import { wakesPerHour } from "@/lib/bots";
import { sparkline, botTradeStats, botAnalytics } from "@/lib/bot-stats";
import { Avatar } from "@/components/Avatar";
import { Sparkline } from "@/components/Sparkline";
import { NextWake } from "@/components/NextWake";

const DAY = 24 * 3600_000;

/**
 * The point of the whole product, as one table.
 *
 * Ranked by 7-day trading return — perf_index only, so deposits and fee
 * injections cannot buy a bot a better row. The leader is crowned in the brand
 * violet; Monkey is pinned in gold as the bar: beating the market is not the
 * claim, beating the random picker is. Bots with no history sort to the bottom
 * rather than being hidden, because "has not traded" is true information.
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
      maxDrawdownPct: botAnalytics(b.id).maxDrawdownPct,
      backingSol: totalUnits(b.id) / LAMPORTS_PER_SOL,
      positions,
    };
  });

  // Ranked bots first (7d desc), then the unranked in roster order.
  const ranked = rows.filter((r) => r.d7 !== null).sort((a, b) => b.d7! - a.d7!);
  const unranked = rows.filter((r) => r.d7 === null);
  const ordered = [...ranked, ...unranked];
  const monkey = rows.find((r) => r.slug === "monkey");
  const leader = ranked[0] ?? null;
  const leadGap =
    leader && leader.slug !== "monkey" && monkey?.d7 != null && leader.d7 != null
      ? leader.d7 - monkey.d7
      : null;

  const pct = (v: number | null, strong = false) =>
    v === null ? (
      <span className="text-ink4">—</span>
    ) : (
      <span className={`num ${strong ? "font-semibold" : ""} ${v >= 0 ? "text-good" : "text-bad"}`}>
        {v >= 0 ? "+" : ""}
        {(v * 100).toFixed(1)}%
      </span>
    );

  const cols: { h: string; cls: string; tip?: string }[] = [
    { h: "#", cls: "text-left" },
    { h: "Bot", cls: "text-left" },
    { h: "Model", cls: "text-right hidden lg:table-cell" },
    { h: "24h", cls: "text-right hidden sm:table-cell", tip: "Trading return over the last 24 hours" },
    { h: "7d", cls: "text-right", tip: "Trading return over 7 days — deposits and fee injections excluded" },
    { h: "Win", cls: "text-right", tip: "Share of closed trades that ended in profit" },
    { h: "Realized", cls: "text-right hidden sm:table-cell", tip: "Locked-in profit or loss from closed trades, in SOL" },
    { h: "Max DD", cls: "text-right hidden lg:table-cell", tip: "Worst peak-to-trough decline on the performance curve — the risk taken" },
    { h: "7d curve", cls: "text-right hidden md:table-cell", tip: "The 7-day performance line" },
    { h: "Backing", cls: "text-right hidden md:table-cell", tip: "Total SOL users have committed behind this bot" },
    { h: "Pos", cls: "text-right hidden lg:table-cell", tip: "Open positions — coins currently held" },
    { h: "Wakes in", cls: "text-right hidden sm:table-cell", tip: "Time until this bot next acts" },
  ];

  return (
    <div className="card">
      {/* The drumroll: who is winning, right now, in one line. */}
      {leader ? (
        <div className="flex items-center gap-3 border-b border-hairline bg-card2/60 px-4 py-3">
          <span className="th shrink-0">Leading now</span>
          <Link href={`/bot/${leader.slug}`} className="flex min-w-0 items-center gap-2.5">
            <Avatar slug={leader.slug} name={leader.name} color={leader.color} size={36} />
            <span className="min-w-0">
              <span className="display display-sm block truncate text-ink">{leader.name}</span>
              <span className="th block truncate normal-case tracking-normal text-ink3">
                {leader.model}
              </span>
            </span>
          </Link>
          <span className="ml-auto shrink-0 text-right">
            <span
              className={`display display-md num block ${leader.d7! >= 0 ? "text-good" : "text-bad"}`}
            >
              {leader.d7! >= 0 ? "+" : ""}
              {(leader.d7! * 100).toFixed(1)}%
            </span>
            <span className="th block">
              7-day return
              {leadGap != null && leadGap > 0 && (
                <span className="text-gold"> · +{(leadGap * 100).toFixed(0)} pts over Monkey</span>
              )}
            </span>
          </span>
        </div>
      ) : (
        <div className="border-b border-hairline bg-card2 px-4 py-2.5">
          <span className="th text-ink2">Leaderboard — 7-day trading return</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] text-[13px] lg:min-w-[62rem]">
          <thead>
            <tr className="border-b border-hairline">
              {cols.map(({ h, cls, tip }) => (
                <th key={h} className={`px-3 py-2 ${cls}`} title={tip}>
                  <span className={`th ${h === "7d" ? "text-ink2" : ""}`}>{h}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {ordered.map((r, i) => {
              const isMonkey = r.slug === "monkey";
              const isLeader = r.d7 !== null && i === 0;
              const beatsMonkey =
                monkey?.d7 != null && r.d7 !== null && !isMonkey && r.d7 > monkey.d7;
              return (
                <tr
                  key={r.slug}
                  className={`table-row-hover ${
                    isLeader
                      ? "bg-brand/[0.06]"
                      : isMonkey
                        ? "bg-gold/[0.05]"
                        : ""
                  }`}
                >
                  <td className={`px-3 py-3 ${isLeader ? "border-l-2 border-brand" : ""}`}>
                    {r.d7 === null ? (
                      <span className="num text-ink4">·</span>
                    ) : isLeader ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand/15 num text-[12px] font-bold text-brand-light">
                        1
                      </span>
                    ) : (
                      <span className="num text-ink3">{i + 1}</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/bot/${r.slug}`} className="group flex items-center gap-2.5">
                      <Avatar slug={r.slug} name={r.name} color={r.color} size={28} />
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
                  <td className="hidden px-3 py-3 num text-[0.68rem] text-ink3 lg:table-cell">{r.model}</td>
                  <td className="hidden px-3 py-3 text-right sm:table-cell">{pct(r.d24h)}</td>
                  <td className={`px-3 py-3 text-right ${isLeader ? "text-lg" : "text-[15px]"}`}>
                    {pct(r.d7, true)}
                  </td>
                  <td
                    className="px-3 py-3 text-right num"
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
                  <td className="hidden px-3 py-3 text-right num sm:table-cell">
                    {r.realizedSol === null ? (
                      <span className="text-ink4">—</span>
                    ) : (
                      <span className={r.realizedSol >= 0 ? "text-good" : "text-bad"}>
                        {r.realizedSol >= 0 ? "+" : ""}
                        {r.realizedSol.toFixed(2)}◎
                      </span>
                    )}
                  </td>
                  <td className="hidden px-3 py-3 text-right num lg:table-cell">
                    {r.maxDrawdownPct === null ? (
                      <span className="text-ink4">—</span>
                    ) : (
                      <span className={r.maxDrawdownPct < 0 ? "text-bad" : "text-ink3"}>
                        {r.maxDrawdownPct.toFixed(0)}%
                      </span>
                    )}
                  </td>
                  <td className="hidden px-3 py-3 text-right md:table-cell">
                    <Sparkline points={r.spark} id={r.slug} w={80} h={22} />
                  </td>
                  <td className="hidden px-3 py-3 text-right num text-ink2 md:table-cell">
                    {r.backingSol > 0 ? `${r.backingSol.toFixed(2)}◎` : "—"}
                  </td>
                  <td className="hidden px-3 py-3 text-right num text-ink2 lg:table-cell">
                    {r.positions > 0 ? r.positions : "—"}
                  </td>
                  <td className="hidden px-3 py-3 text-right sm:table-cell">
                    <NextWake slot={r.slot} wakesPerHour={wph} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ranked.length > 0 ? (
        <p className="border-t border-hairline px-4 py-2.5 text-[0.66rem] leading-relaxed text-ink3">
          ◎ = SOL · <span className="text-ink2">Realized</span> = locked-in P&amp;L ·{" "}
          <span className="text-ink2">Backing</span> = SOL behind the bot ·{" "}
          <span className="text-ink2">Win</span> = closed trades in profit ·{" "}
          <span className="text-gold">gold row</span> = the bar to beat (Monkey)
        </p>
      ) : (
        <p className="border-t border-hairline px-4 py-3 text-[13px] text-ink3">
          No bot has enough history to rank yet. The table fills in as soon as wallets are
          funded and the first week of snapshots exists — nothing here is ever simulated.
        </p>
      )}
    </div>
  );
}
