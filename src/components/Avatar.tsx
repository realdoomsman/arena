/**
 * A bot's mark.
 *
 * Generated, not drawn: eleven hand-made avatars would be eleven files to keep
 * in sync with a roster that changes. Each bot gets a different SHAPE as well
 * as a different colour, because on a dark ground several of the hues sit close
 * enough that colour alone did not separate them — the silhouette does the work
 * and the colour confirms it.
 *
 * Deterministic per slug, so a bot always looks the same everywhere.
 */

type Glyph = (c: string) => React.ReactNode;

const GLYPHS: Glyph[] = [
  // circle
  (c) => <circle cx="16" cy="16" r="10" fill={c} />,
  // square
  (c) => <rect x="6.5" y="6.5" width="19" height="19" rx="3" fill={c} />,
  // diamond
  (c) => <path d="M16 4.5 27.5 16 16 27.5 4.5 16Z" fill={c} />,
  // hexagon
  (c) => <path d="M16 4.5 26 10.25v11.5L16 27.5 6 21.75v-11.5Z" fill={c} />,
  // triangle
  (c) => <path d="M16 5.5 27 25.5H5Z" fill={c} />,
  // ring
  (c) => <circle cx="16" cy="16" r="9" fill="none" stroke={c} strokeWidth="5" />,
  // rounded blade
  (c) => <path d="M6 16a10 10 0 0 1 20 0 10 10 0 0 1-20 0Z M16 6v20" fill={c} />,
  // quartered square
  (c) => (
    <>
      <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" fill={c} />
      <rect x="16.5" y="16.5" width="9" height="9" rx="1.5" fill={c} />
    </>
  ),
  // chevron
  (c) => <path d="M8 8h6l10 8-10 8H8l10-8Z" fill={c} />,
  // cross
  (c) => <path d="M13 5h6v8h8v6h-8v8h-6v-8H5v-6h8Z" fill={c} />,
  // pill
  (c) => <rect x="4" y="10" width="24" height="12" rx="6" fill={c} />,
];

export function Avatar({
  slug,
  name,
  color,
  size = 26,
  dim,
}: {
  slug: string;
  name: string;
  color: string;
  size?: number;
  dim?: boolean;
}) {
  const seed = [...slug].reduce((a, c) => a + c.charCodeAt(0), 0);
  const glyph = GLYPHS[seed % GLYPHS.length];

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md transition-opacity"
      style={{
        width: size,
        height: size,
        // A top-lit ground + a thin rim in the bot's own colour give the mark
        // dimensional, coin-like weight. Kept to a whisper — no bevel, no gloss.
        background: dim
          ? "transparent"
          : `radial-gradient(120% 120% at 50% 0%, color-mix(in oklab, ${color} 26%, transparent), color-mix(in oklab, ${color} 9%, transparent))`,
        boxShadow: dim
          ? undefined
          : `inset 0 0 0 1px color-mix(in oklab, ${color} 42%, transparent), inset 0 1px 0 0 rgba(255,255,255,0.10)`,
        opacity: dim ? 0.4 : 1,
      }}
      role="img"
      aria-label={name}
    >
      <svg width={size * 0.7} height={size * 0.7} viewBox="0 0 32 32">
        {glyph(color)}
      </svg>
    </span>
  );
}
