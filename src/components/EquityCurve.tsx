import { getBotCurve, listBots, type CurvePoint } from "@/lib/bot-nav";

/**
 * A bot's trading performance against the controls.
 *
 * Plots perf_index — trading only — NOT nav_per_unit. Those are different
 * numbers on purpose: fee injections raise what a unit is worth without the
 * model having earned anything, and a chart that blurred the two would let a
 * well-funded bot look like a good one.
 *
 * Rendered as inline SVG with no chart library: it is one polyline per series,
 * and a dependency would cost more than it saves.
 */
export function EquityCurve({ botId, days = 30 }: { botId: number; days?: number }) {
  // eslint-disable-next-line react-hooks/purity
  const since = Date.now() - days * 24 * 3600_000;
  const mine = getBotCurve(botId, since);

  // The comparison that gives the number meaning. Beating the market is not
  // the bar; beating the random picker is.
  const monkey = listBots().find((b) => b.slug === "monkey");
  const monkeyCurve = monkey && monkey.id !== botId ? getBotCurve(monkey.id, since) : [];

  if (mine.length < 2) {
    return (
      <p className="px-5 py-6 text-sm text-ink3">
        Not enough history to plot. A curve drawn through one point would be decoration, not
        data.
      </p>
    );
  }

  const series = [
    { points: mine, color: "var(--brand)", label: "this bot" },
    ...(monkeyCurve.length >= 2
      ? [{ points: monkeyCurve, color: "var(--gold)", label: "monkey" }]
      : []),
  ];

  const all = series.flatMap((s) => s.points);
  const tMin = Math.min(...all.map((p) => p[0]));
  const tMax = Math.max(...all.map((p) => p[0]));
  const vMin = Math.min(...all.map((p) => p[2]));
  const vMax = Math.max(...all.map((p) => p[2]));
  const span = Math.max(vMax - vMin, 1e-9);
  const tSpan = Math.max(tMax - tMin, 1);

  const W = 720;
  const H = 200;
  const PAD = 8;

  const toPath = (pts: CurvePoint[]) =>
    pts
      .map((p, i) => {
        const x = PAD + ((p[0] - tMin) / tSpan) * (W - PAD * 2);
        const y = H - PAD - ((p[2] - vMin) / span) * (H - PAD * 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const last = mine[mine.length - 1][2];
  const first = mine[0][2];
  const change = first > 0 ? (last / first - 1) * 100 : 0;

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-4">
        <span
          className={`font-display text-2xl font-semibold tabular-nums ${
            change >= 0 ? "text-good" : "text-bad"
          }`}
        >
          {change >= 0 ? "+" : ""}
          {change.toFixed(1)}%
        </span>
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 font-mono text-[0.62rem] text-ink3">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[20rem]"
          role="img"
          aria-label={`Trading return over ${days} days: ${change.toFixed(1)} percent`}
        >
          {/* Baseline at the starting value — above it is profit, below is loss. */}
          <line
            x1={PAD}
            x2={W - PAD}
            y1={H - PAD - ((first - vMin) / span) * (H - PAD * 2)}
            y2={H - PAD - ((first - vMin) / span) * (H - PAD * 2)}
            stroke="var(--baseline)"
            strokeDasharray="3 3"
            strokeWidth="1"
          />
          {series.map((s) => (
            <polyline
              key={s.label}
              points={toPath(s.points).replace(/[ML]/g, " ").trim()}
              fill="none"
              stroke={s.color}
              strokeWidth={s.label === "this bot" ? 2 : 1.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={s.label === "this bot" ? 1 : 0.7}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
