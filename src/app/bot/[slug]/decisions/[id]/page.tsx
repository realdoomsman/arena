import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getBot } from "@/lib/bot-nav";
import { personaFor } from "@/lib/bot-persona";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import type { MarketSnapshot } from "@/lib/bot-decision";
import { Scroller } from "@/components/Scroller";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  bot_id: number;
  ts: number;
  market_snapshot: string;
  rationale: string;
  actions: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  error: string | null;
};

/**
 * One decision, in full.
 *
 * The point of this page is the snapshot: the exact bytes the model was handed.
 * Without it, "this model beat that one" is a claim you have to take on faith,
 * because you cannot check they were shown the same thing. With it, anyone can
 * replay the input and judge the call for themselves.
 */
export default async function DecisionPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const bot = getBot(slug);
  if (!bot) notFound();

  const db = getDb();
  const row = db
    .prepare("SELECT * FROM bot_decisions WHERE id = ? AND bot_id = ?")
    .get(Number(id), bot.id) as Row | undefined;
  if (!row) notFound();

  const persona = personaFor(bot.slug);
  const trades = db
    .prepare("SELECT * FROM bot_trades WHERE decision_id = ? ORDER BY ts")
    .all(row.id) as {
    id: number;
    symbol: string;
    side: string;
    lamports: number;
    qty: number;
    signature: string;
  }[];

  let snap: MarketSnapshot | null = null;
  try {
    snap = JSON.parse(row.market_snapshot) as MarketSnapshot;
  } catch {
    snap = null;
  }

  const parsed = JSON.parse(row.actions || "{}") as {
    actions?: { kind: string; idx?: number; mint?: string; fraction: number }[];
    notes?: { kept: boolean; reason: string }[];
  };
  const refused = (parsed.notes ?? []).filter((n) => !n.kept);

  return (
    <Scroller>
    <div className="mx-auto max-w-4xl px-4 py-12">
      <Link href={`/bot/${bot.slug}`} className="font-mono text-[0.7rem] text-ink3 hover:text-brand">
        ← {bot.name}
      </Link>

      <header className="mt-6 border-b border-hairline pb-6">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink3">
          {new Date(row.ts).toISOString().replace("T", " ").slice(0, 19)} UTC
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">
          <span style={{ color: persona.color }}>{bot.name}</span> decided
        </h1>
        <p className="mt-1 font-mono text-[0.68rem] text-ink3">
          {bot.kind === "control" ? "no model · code only" : bot.model}
          {row.latency_ms ? ` · thought for ${(row.latency_ms / 1000).toFixed(1)}s` : ""}
          {row.cost_usd ? ` · cost $${row.cost_usd.toFixed(4)}` : ""}
          {row.tokens_in ? ` · ${row.tokens_in.toLocaleString()} in / ${row.tokens_out?.toLocaleString() ?? 0} out` : ""}
        </p>
      </header>

      {row.error ? (
        <Block title="It failed">
          <p className="px-5 py-4 font-mono text-sm text-bad">{row.error}</p>
          <p className="px-5 pb-4 text-xs text-ink3">
            A failed wake-up is part of the record. It is kept rather than retried into
            invisibility, because a bot whose brain is unreachable half the time is a fact
            about that bot.
          </p>
        </Block>
      ) : (
        <Block title="What it said" note="Verbatim, unedited, however it reads now.">
          <p className="whitespace-pre-wrap px-5 py-4 leading-relaxed text-ink2">{row.rationale}</p>
        </Block>
      )}

      <Block title="What it did">
        {(parsed.actions ?? []).length === 0 && trades.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink3">
            Nothing. It looked and chose to hold — which is a decision, and is recorded like
            any other.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {trades.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
                <span className="font-mono text-sm">
                  <span className={t.side === "buy" ? "text-good" : "text-bad"}>{t.side}</span>{" "}
                  {t.symbol}
                </span>
                <span className="font-mono text-xs tabular-nums text-ink3">
                  {(t.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL ·{" "}
                  <a
                    href={`https://solscan.io/tx/${t.signature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-brand"
                  >
                    solscan
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {refused.length > 0 && (
        <Block
          title="What the executor refused"
          note="Published rather than hidden. A model asking for something the rules forbid is worth seeing."
        >
          <ul className="divide-y divide-hairline">
            {refused.map((n, i) => (
              <li key={i} className="px-5 py-3 font-mono text-xs text-warn">
                {n.reason}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {snap && (
        <>
          <Block
            title="What it was holding"
            note={`${snap.positions?.length ?? 0} position(s) · ${((snap.idleLamports ?? 0) / LAMPORTS_PER_SOL).toFixed(4)} SOL idle`}
          >
            {(snap.positions ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink3">Nothing. All cash.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {snap.positions.map((p) => (
                  <li key={p.mint} className="flex justify-between px-5 py-2.5 font-mono text-xs">
                    <span>{p.symbol}</span>
                    <span className={p.pnlPct >= 0 ? "text-good" : "text-bad"}>
                      {p.pnlPct.toFixed(1)}% · {p.heldHours.toFixed(0)}h
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block
            title="What it was shown"
            note="The exact eligible list handed to every bot this hour. This is the receipt."
          >
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card2">
                  <tr>
                    {["idx", "symbol", "price", "24h", "liquidity", "mcap", "launchpad"].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-mono text-[0.6rem] uppercase tracking-[0.1em] font-normal text-ink3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {(snap.eligible ?? []).map((t) => (
                    <tr key={t.mint} className="border-t border-hairline">
                      <td className="px-3 py-1.5 text-ink3">{t.idx}</td>
                      <td className="px-3 py-1.5">{t.symbol}</td>
                      <td className="px-3 py-1.5">${t.priceUsd.toPrecision(4)}</td>
                      <td
                        className={`px-3 py-1.5 ${
                          (t.change24h ?? 0) >= 0 ? "text-good" : "text-bad"
                        }`}
                      >
                        {t.change24h == null ? "—" : `${t.change24h.toFixed(1)}%`}
                      </td>
                      <td className="px-3 py-1.5 text-ink3">
                        ${Math.round(t.liquidityUsd).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-ink3">
                        {t.mcapUsd ? `$${Math.round(t.mcapUsd).toLocaleString()}` : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-ink3">{t.launchpad ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>
        </>
      )}
    </div>
    </Scroller>
  );
}

function Block({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline pb-2">
        <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
        {note && <p className="max-w-[52ch] text-xs text-ink3">{note}</p>}
      </div>
      <div className="border-x border-b border-hairline bg-card">{children}</div>
    </section>
  );
}
