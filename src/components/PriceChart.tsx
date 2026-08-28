import type { PricePoint } from "@/lib/prices";

/**
 * A week of hourly closes, as one line. Real data or nothing: when the
 * history feed has no pool for the token, no chart renders — a flat
 * placeholder line would be exactly the fake chart this site exists not to
 * show. Display only; valuations never read from here.
 */
export function PriceChart({ points }: { points: PricePoint[] }) {
  if (points.length < 2) return null;

  const values = points.map((p) => p[1]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, min * 1e-9, 1e-18);
  const first = values[0];
  const last = values[values.length - 1];
  const change = first > 0 ? (last / first - 1) * 100 : 0;
  const up = change >= 0;

  const W = 720;
  const H = 180;
  const PAD = 6;
  const t0 = points[0][0];
  const tSpan = Math.max(points[points.length - 1][0] - t0, 1);
  const path = points
    .map((p) => {
      const x = PAD + ((p[0] - t0) / tSpan) * (W - PAD * 2);
      const y = H - PAD - ((p[1] - min) / span) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const days = (points[points.length - 1][0] - t0) / 86_400_000;
  const price = (v: number) => (v >= 1 ? v.toFixed(2) : v.toPrecision(3));

  return (
    <div className="card mt-4 p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-4">
        <span className={`num text-lg font-semibold ${up ? "text-good" : "text-bad"}`}>
          {up ? "+" : ""}
          {change.toFixed(1)}%
        </span>
        <span className="th">
          {days >= 1.5 ? `${Math.round(days)}d` : `${Math.round(days * 24)}h`} · hourly closes ·
          geckoterminal
        </span>
        <span className="th ml-auto num">
          hi ${price(max)} · lo ${price(min)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[20rem]"
          role="img"
          aria-label={`Price over ${Math.round(days)} days: ${change.toFixed(1)} percent`}
        >
          <polyline
            points={path}
            fill="none"
            stroke={up ? "var(--good)" : "var(--bad)"}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
