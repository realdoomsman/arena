/**
 * A seven-day performance line in 96×28 pixels.
 *
 * Color states the verdict (up = good, down = bad) so the shape only has to
 * carry the story. A faint area fill under the line and a soft endpoint halo
 * give it premium, "alive" weight without a chart's clutter. Fewer than two
 * points renders a quiet dash — a flat invented line would be decoration
 * pretending to be data.
 */
export function Sparkline({
  points,
  id,
  w = 96,
  h = 28,
}: {
  points: number[];
  /** Stable, unique per instance (e.g. the bot slug) — keeps the SVG gradient
      ids from colliding across the many sparklines on one page. */
  id?: string;
  w?: number;
  h?: number;
}) {
  if (points.length < 2) return <span className="text-ink4">—</span>;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 1e-9);
  const pad = 2;
  const step = (w - pad * 2) / (points.length - 1);

  const coords = points.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = coords[coords.length - 1];
  const area = `${line} L ${lastX.toFixed(1)} ${h} L ${coords[0][0].toFixed(1)} ${h} Z`;

  const up = points[points.length - 1] >= points[0];
  const color = up ? "var(--good)" : "var(--bad)";
  const gid = `sl-${up ? "u" : "d"}-${id ?? points.length}`;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="inline-block align-middle"
      role="img"
      aria-label={`7-day trend, ${up ? "up" : "down"}`}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r="3.5" fill={color} opacity="0.28" />
      <circle cx={lastX} cy={lastY} r="2" fill={color} />
    </svg>
  );
}
