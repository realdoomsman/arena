import Link from "next/link";
import { latestFills } from "@/lib/bot-stats";
import { personaFor } from "@/lib/bot-persona";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";

/**
 * The tape. Latest on-chain fills across the whole arena, newest first.
 * Renders nothing before the first trade — an empty tape is not a feature.
 */
export function TradeTicker() {
  const fills = latestFills(14);
  if (fills.length === 0) return null;

  const ago = (ts: number) => {
    // eslint-disable-next-line react-hooks/purity
    const m = Math.max(0, Math.round((Date.now() - ts) / 60_000));
    if (m < 60) return `${m}m`;
    if (m < 24 * 60) return `${Math.round(m / 60)}h`;
    return `${Math.round(m / 1440)}d`;
  };

  return (
    <div className="border-b border-hairline bg-card/40">
      <div className="mx-auto flex max-w-[86rem] items-center gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-width:none]">
        <span className="th shrink-0 pr-1">tape</span>
        {fills.map((f, i) => (
          <Link
            key={`${f.ts}-${i}`}
            href={`/bot/${f.slug}`}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-card px-2.5 py-0.5 font-mono text-[0.64rem] text-ink3 transition-colors hover:border-hairline-3 hover:text-ink2"
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: personaFor(f.slug).color }}
            />
            <span className={f.side === "buy" ? "text-good" : "text-bad"}>
              {f.side === "buy" ? "▲" : "▼"}
            </span>
            <span className="text-ink2">{f.symbol}</span>
            <span className="num">{(f.lamports / LAMPORTS_PER_SOL).toFixed(2)}◎</span>
            <span>{ago(f.ts)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
