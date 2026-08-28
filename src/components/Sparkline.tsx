/**
 * A seven-day performance line in 96×28 pixels.
 *
 * Color states the verdict (up = good, down = bad) so the shape only has to
 * carry the story. Fewer than two points renders a quiet dash — a flat
 * invented line would be decoration pretending to be data.
 */
export function Sparkline({
  points,
  w = 96,
  h = 28,
}: {
  points: number[];
  w?: number;
  h?: number;
}) {
  if (points.length < 2) return <span className="text-ink4">—</span>;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 1e-9);
  const pad = 2;
  const step = (w - pad * 2) / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const up = points[points.length - 1] >= points[0];
  const color = up ? "var(--good)" : "var(--bad)";

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="inline-block align-middle"
      role="img"
      aria-label={`7-day trend, ${up ? "up" : "down"}`}
    >
      <polyline
        points={path}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={pad + (points.length - 1) * step}
        cy={h - pad - ((points[points.length - 1] - min) / span) * (h - pad * 2)}
        r="2"
        fill={color}
      />
    </svg>
  );
}
