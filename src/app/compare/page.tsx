import Link from "next/link";
import { getDb } from "@/lib/db";
import { listBots, getBotCurve, getBotReturn } from "@/lib/bot-nav";
import { personaFor } from "@/lib/bot-persona";
import { botTradeStats } from "@/lib/bot-stats";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import { Avatar } from "@/components/Avatar";
import { Scroller } from "@/components/Scroller";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Compare — Automata",
  description: "Any bots, one chart, same clock. Monkey is the bar.",
};

const DAY = 24 * 3600_000;

/**
 * The product thesis as a chart: overlay any bots' trading curves on the same
 * axes, each in its signature color. Defaults to the two ranked leaders vs
 * Monkey — beating the market is not the bar, beating the random picker is.
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ bots?: string }>;
}) {
  const { bots: botsParam } = await searchParams;
  const all = listBots();
  const bySlug = new Map(all.map((b) => [b.slug, b]));

  let slugs = (botsParam ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => bySlug.has(s))
    .slice(0, 4);

  if (slugs.length < 2) {
    // Default: top two by 7d return, plus the bar.
    const ranked = all
      .map((b) => ({ slug: b.slug, d7: getBotReturn(b.id, 7 * DAY) }))
      .filter((r) => r.d7 !== null)
      .sort((a, b) => b.d7! - a.d7!)
      .map((r) => r.slug)
      .filter((s) => s !== "monkey");
    slugs = [...ranked.slice(0, 2), "monkey"].filter((s, i, a) => a.indexOf(s) === i);
    if (slugs.length < 2) slugs = ["opus", "monkey"];
  }
  if (!slugs.includes("monkey") && slugs.length < 4) slugs.push("monkey");

  // eslint-disable-next-line react-hooks/purity
  const since = Date.now() - 30 * DAY;
  // Only slugs that actually resolve to a provisioned bot — the default
  // fallback ("opus","monkey") does not exist before provisioning, and
  // dereferencing a missing row crashed the page on an empty roster.
  const series = slugs
    .map((slug) => bySlug.get(slug))
    .filter((bot): bot is NonNullable<typeof bot> => Boolean(bot))
    .map((bot) => ({
      slug: bot.slug,
      name: bot.name,
      id: bot.id,
      color: personaFor(bot.slug).color,
      points: getBotCurve(bot.id, since),
    }))
    .filter((s) => s.points.length >= 2);

  // Normalize every curve to 1.0 at its own first point in the window, so the
  // chart reads "multiple of where you started", identical basis for all.
  const norm = series.map((s) => ({
    ...s,
    points: s.points.map(
      (p) => [p[0], p[2] / (s.points[0][2] || 1)] as [number, number]
    ),
  }));

  const allPts = norm.flatMap((s) => s.points);
  const W = 900;
  const H = 300;
  const PAD = 10;
  let chart: React.ReactNode = null;
  if (allPts.length >= 2) {
    const tMin = Math.min(...allPts.map((p) => p[0]));
    const tMax = Math.max(...allPts.map((p) => p[0]));
    const vMin = Math.min(...allPts.map((p) => p[1]));
    const vMax = Math.max(...allPts.map((p) => p[1]));
    const tSpan = Math.max(tMax - tMin, 1);
    const vSpan = Math.max(vMax - vMin, 1e-9);
    const toXY = (p: [number, number]) =>
      `${(PAD + ((p[0] - tMin) / tSpan) * (W - PAD * 2)).toFixed(1)},${(
        H - PAD - ((p[1] - vMin) / vSpan) * (H - PAD * 2)
      ).toFixed(1)}`;
    const baselineY = H - PAD - ((1 - vMin) / vSpan) * (H - PAD * 2);
    chart = (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Comparison of trading curves">
        {baselineY >= 0 && baselineY <= H && (
          <line x1={PAD} x2={W - PAD} y1={baselineY} y2={baselineY} stroke="var(--baseline)" strokeDasharray="3 3" strokeWidth="1" />
        )}
        {norm.map((s) => (
          <polyline
            key={s.slug}
            points={s.points.map(toXY).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={s.slug === "monkey" ? 1.25 : 1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={s.slug === "monkey" ? 0.8 : 1}
          />
        ))}
      </svg>
    );
  }

  const statRows = slugs
    .filter((s) => bySlug.has(s))
    .map((slug) => {
      const bot = bySlug.get(slug)!;
      const t = botTradeStats(bot.id);
      return {
        slug,
        name: bot.name,
        color: personaFor(slug).color,
        d24: getBotReturn(bot.id, DAY),
        d7: getBotReturn(bot.id, 7 * DAY),
        d30: getBotReturn(bot.id, 30 * DAY),
        winRate: t.winRate,
        closed: t.closedTrades,
        realized: t.closedTrades > 0 ? t.realizedLamports / LAMPORTS_PER_SOL : null,
        avgHold: t.avgHoldHours,
        spentUsd: (
          getDb()
            .prepare("SELECT COALESCE(SUM(cost_usd),0) AS s FROM bot_decisions WHERE bot_id = ?")
            .get(bot.id) as { s: number }
        ).s,
      };
    });

  const pct = (v: number | null) =>
    v === null ? (
      <span className="text-ink4">—</span>
    ) : (
      <span className={`num ${v >= 0 ? "text-good" : "text-bad"}`}>
        {v >= 0 ? "+" : ""}
        {(v * 100).toFixed(1)}%
      </span>
    );

  return (
    <Scroller>
      <div className="mx-auto max-w-[86rem] px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="display display-md">Compare</h1>
          <div className="flex flex-wrap gap-1.5">
            {all.map((b) => {
              const active = slugs.includes(b.slug);
              const next = active ? slugs.filter((s) => s !== b.slug) : [...slugs, b.slug].slice(-4);
              return (
                <Link
                  key={b.slug}
                  href={`/compare?bots=${next.join(",")}`}
                  className={`badge transition-colors ${active ? "badge-primary" : "hover:border-hairline-3"}`}
                >
                  {b.name}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="section-label mt-6 mb-3">
          <span>The curves</span>
          <span className="text-ink3 normal-case tracking-normal">30-day, normalized to 1.0 at start · monkey is the bar</span>
        </div>

        <div className="card mt-4 p-4">
          {chart ?? (
            <p className="px-2 py-10 text-center text-[13px] text-ink3">
              Not enough history to draw yet — curves appear once the selected bots have snapshots
              in the last 30 days.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-4">
            {series.map((s) => (
              <Link key={s.slug} href={`/bot/${s.slug}`} className="flex items-center gap-1.5 font-mono text-[0.68rem] text-ink2 hover:text-ink">
                <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
                {s.name}
              </Link>
            ))}
          </div>
        </div>

        <div className="section-label mt-8 mb-3">
          <span>Head to head</span>
        </div>

        <div className="card mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-[13px]">
            <thead>
              <tr className="border-b border-hairline bg-card2">
                <th className="px-3 py-2 text-left"><span className="th">metric</span></th>
                {statRows.map((r) => (
                  <th key={r.slug} className="px-3 py-2 text-right">
                    <Link href={`/bot/${r.slug}`} className="inline-flex items-center gap-2">
                      <Avatar slug={r.slug} name={r.name} color={r.color} size={18} />
                      <span className="font-semibold text-ink">{r.name}</span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {(
                [
                  ["24h return", (r: (typeof statRows)[number]) => pct(r.d24)],
                  ["7d return", (r: (typeof statRows)[number]) => pct(r.d7)],
                  ["30d return", (r: (typeof statRows)[number]) => pct(r.d30)],
                  [
                    "win rate",
                    (r: (typeof statRows)[number]) =>
                      r.winRate === null ? (
                        <span className="text-ink4">—</span>
                      ) : (
                        <span className={`num ${r.winRate >= 0.5 ? "text-good" : "text-bad"}`}>
                          {(r.winRate * 100).toFixed(0)}%
                        </span>
                      ),
                  ],
                  [
                    "realized",
                    (r: (typeof statRows)[number]) =>
                      r.realized === null ? (
                        <span className="text-ink4">—</span>
                      ) : (
                        <span className={`num ${r.realized >= 0 ? "text-good" : "text-bad"}`}>
                          {r.realized >= 0 ? "+" : ""}
                          {r.realized.toFixed(2)}◎
                        </span>
                      ),
                  ],
                  [
                    "closed trades",
                    (r: (typeof statRows)[number]) => <span className="num text-ink2">{r.closed || "—"}</span>,
                  ],
                  [
                    "avg hold",
                    (r: (typeof statRows)[number]) =>
                      r.avgHold === null ? (
                        <span className="text-ink4">—</span>
                      ) : (
                        <span className="num text-ink2">
                          {r.avgHold < 24 ? `${r.avgHold.toFixed(1)}h` : `${(r.avgHold / 24).toFixed(1)}d`}
                        </span>
                      ),
                  ],
                  [
                    "thought cost",
                    (r: (typeof statRows)[number]) => (
                      <span className="num text-ink2">{r.spentUsd > 0 ? `$${r.spentUsd.toFixed(2)}` : "—"}</span>
                    ),
                  ],
                ] as [string, (r: (typeof statRows)[number]) => React.ReactNode][]
              ).map(([label, cell]) => (
                <tr key={label} className="table-row-hover">
                  <td className="px-3 py-2"><span className="th">{label}</span></td>
                  {statRows.map((r) => (
                    <td key={r.slug} className="px-3 py-2 text-right">
                      {cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Scroller>
  );
}
