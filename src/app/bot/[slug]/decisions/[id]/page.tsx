import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getBot } from "@/lib/bot-nav";
import { personaFor } from "@/lib/bot-persona";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import type { MarketSnapshot } from "@/lib/bot-decision";
import { Scroller } from "@/components/Scroller";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const bot = getBot(slug);
  return { title: bot ? `${bot.name} · decision #${id} — Automata` : "Not found — Automata" };
}

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
  tool_log: string | null;
};

/**
 * One decision, in full - SUPER ENHANCED UI
 *
 * Shows the exact bytes the model was handed, its reasoning, execution results,
 * and connects to the trade outcomes.
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
  // The publish embargo applies here too — an in-flight decision must not be
  // readable by id while its swaps are still landing.
  const row = db
    .prepare(
      `SELECT * FROM bot_decisions
       WHERE id = ? AND bot_id = ? AND (published_at IS NOT NULL OR error IS NOT NULL)`
    )
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

  let lookups: { query: string; results: number }[] = [];
  try {
    lookups = row.tool_log ? (JSON.parse(row.tool_log) as typeof lookups) : [];
  } catch {
    /* older rows have no tool log */
  }
  // parsed.actions is already the post-validation kept list — the executor
  // stores exactly what survived, so re-deriving kept-ness here would only
  // add ways to be wrong.
  const actions = parsed.actions ?? [];

  return (
    <Scroller>
      <div className="mx-auto max-w-5xl px-5 py-10">
        <div className="flex items-center justify-between gap-4">
          <Link
            href={`/bot/${bot.slug}`}
            className="font-mono text-[0.75rem] text-ink3 hover:text-brand inline-flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to {bot.name}
          </Link>
          <div className="flex items-center gap-4 font-mono text-[0.72rem]">
            {(() => {
              const prev = db
                .prepare(
                  `SELECT id FROM bot_decisions WHERE bot_id = ? AND id < ?
                   AND (published_at IS NOT NULL OR error IS NOT NULL) ORDER BY id DESC LIMIT 1`
                )
                .get(bot.id, row.id) as { id: number } | undefined;
              const next = db
                .prepare(
                  `SELECT id FROM bot_decisions WHERE bot_id = ? AND id > ?
                   AND (published_at IS NOT NULL OR error IS NOT NULL) ORDER BY id ASC LIMIT 1`
                )
                .get(bot.id, row.id) as { id: number } | undefined;
              return (
                <>
                  {prev ? (
                    <Link href={`/bot/${bot.slug}/decisions/${prev.id}`} className="text-ink3 hover:text-brand">
                      ← earlier
                    </Link>
                  ) : (
                    <span className="text-ink3/60">← earlier</span>
                  )}
                  {next ? (
                    <Link href={`/bot/${bot.slug}/decisions/${next.id}`} className="text-ink3 hover:text-brand">
                      later →
                    </Link>
                  ) : (
                    <span className="text-ink3/60">later →</span>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <header className="mt-8 border-b border-hairline pb-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: persona.color }}
            />
            <span className="font-mono text-[0.7rem] uppercase tracking-wider text-ink3">
              Decision #{row.id}
            </span>
          </div>
          
          <h1 className="font-display text-3xl font-bold tracking-tight mb-4">
            <span style={{ color: persona.color }}>{bot.name}</span> decided
          </h1>
          
          <div className="flex flex-wrap items-center gap-4 font-mono text-[0.7rem] text-ink3">
            <span className="tabular-nums">
              {new Date(row.ts).toISOString().replace("T", " ").slice(0, 19)} UTC
            </span>
            <span>·</span>
            <span>{bot.kind === "control" ? "no model · code only" : bot.model}</span>
            {row.latency_ms ? (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {(row.latency_ms / 1000).toFixed(1)}s thought time
                </span>
              </>
            ) : null}
            {row.cost_usd ? (
              <>
                <span>·</span>
                <span>${row.cost_usd.toFixed(4)} inference cost</span>
              </>
            ) : null}
            {row.tokens_in ? (
              <>
                <span>·</span>
                <span>{row.tokens_in.toLocaleString()} tokens in · {row.tokens_out?.toLocaleString() ?? 0} out</span>
              </>
            ) : null}
          </div>
        </header>

        {/* ── Error State ─────────────────────────────────────────────────── */}
        {row.error ? (
          <div className="mt-6 rounded-lg border-l-4 border-bad bg-bad/5 p-5">
            <h2 className="font-display text-lg font-semibold text-bad mb-2">Failed to execute</h2>
            <p className="font-mono text-sm text-bad">{row.error}</p>
            <p className="mt-3 text-xs text-ink3 leading-relaxed">
              A failed wake-up is part of the record. It is kept rather than retried into
              invisibility, because a bot whose brain is unreachable half the time is a fact
              about that bot.
            </p>
          </div>
        ) : null}

        {/* ── What it looked up ─────────────────────────────────────────────── */}
        {lookups.length > 0 && (
          <section className="mt-6 rounded-xl border border-hairline bg-card overflow-hidden">
            <div className="border-b border-hairline bg-card2/50 px-5 py-3">
              <h2 className="font-display text-lg font-semibold">What it looked up</h2>
              <p className="font-mono text-[0.64rem] text-ink3 mt-1">
                Live searches the model ran before deciding — its own research, published
              </p>
            </div>
            <ul className="divide-y divide-hairline">
              {lookups.map((l, i) => (
                <li key={i} className="flex items-baseline justify-between px-6 py-2.5 font-mono text-sm">
                  <span className="text-ink2">&ldquo;{l.query}&rdquo;</span>
                  <span className="text-[0.7rem] text-ink3">
                    {l.results} result{l.results === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── What It Said (Rationale) ─────────────────────────────────────── */}
        <section className="mt-8 rounded-xl border border-hairline bg-card overflow-hidden">
          <div className="border-b border-hairline bg-card2/50 px-5 py-3">
            <h2 className="font-display text-lg font-semibold">What it said</h2>
            <p className="font-mono text-[0.64rem] text-ink3 mt-1">
              Verbatim, unedited reasoning — however it reads now
            </p>
          </div>
          <div className="px-6 py-5">
            <p className="whitespace-pre-wrap leading-relaxed text-ink2 text-sm">
              {row.rationale}
            </p>
          </div>
        </section>

        {/* ── What It Did (Actions) ─────────────────────────────────────────── */}
        <section className="mt-6 rounded-xl border border-hairline bg-card overflow-hidden">
          <div className="border-b border-hairline bg-card2/50 px-5 py-3">
            <h2 className="font-display text-lg font-semibold">What it did</h2>
            <p className="font-mono text-[0.64rem] text-ink3 mt-1">
              Actions executed on-chain
            </p>
          </div>
          
          {actions.length === 0 && trades.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-ink/5 mb-3">
                <svg className="h-6 w-6 text-ink3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm text-ink3">
                Nothing. It looked and chose to hold — which is a decision, and is recorded like
                any other.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-hairline">
              {trades.length === 0 && actions.length > 0 && (
                <div className="px-6 py-4">
                  <p className="text-sm text-ink3">
                    {actions.length} approved action{actions.length === 1 ? "" : "s"} produced no
                    confirmed fill — the swap failed or never landed. Only confirmed on-chain
                    trades are recorded, so nothing is shown as executed.
                  </p>
                  <ul className="mt-3 space-y-1 font-mono text-[0.7rem] text-ink3">
                    {actions.map((a, i) => {
                      const target =
                        a.kind === "buy"
                          ? a.idx !== undefined && a.idx !== null
                            ? `idx ${a.idx}`
                            : a.mint
                              ? `${a.mint.slice(0, 8)}…`
                              : "—"
                          : `${(a.mint ?? "").slice(0, 8)}…`;
                      return (
                        <li key={i}>
                          {a.kind} {target} · {(a.fraction * 100).toFixed(1)}%
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {trades.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-6 py-4 hover:bg-card2/30 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`h-2.5 w-2.5 rounded-full ${
                      t.side === 'buy' ? 'bg-good' : 'bg-bad'
                    }`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-ink">
                          {t.symbol}
                        </span>
                        <span className={`font-mono text-xs font-medium px-2 py-0.5 rounded ${
                          t.side === 'buy' ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'
                        }`}>
                          {t.side.toUpperCase()}
                        </span>
                      </div>
                      <div className="font-mono text-[0.7rem] text-ink3 mt-1">
                        {t.qty.toPrecision(6)} tokens · {(t.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
                      </div>
                    </div>
                  </div>
                  <a
                    href={`https://solscan.io/tx/${t.signature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-hairline bg-card px-3 py-2 font-mono text-[0.7rem] text-ink3 hover:border-brand/50 hover:text-brand transition-colors"
                  >
                    View on Solscan ↗
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── What the Executor Refused ─────────────────────────────────────── */}
        {refused.length > 0 && (
          <section className="mt-6 rounded-xl border border-warn/30 bg-warn/5 overflow-hidden">
            <div className="border-b border-warn/20 bg-warn/10 px-5 py-3">
              <h2 className="font-display text-lg font-semibold text-warn">What the executor refused</h2>
              <p className="font-mono text-[0.64rem] text-warn/80 mt-1">
                Published rather than hidden. A model asking for something the rules forbid is worth seeing.
              </p>
            </div>
            <ul className="divide-y divide-warn/10">
              {refused.map((n, i) => (
                <li key={i} className="px-6 py-3 font-mono text-sm text-warn">
                  <div className="flex items-start gap-2">
                    <svg className="h-5 w-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    {n.reason}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── What It Saw (Snapshot) ─────────────────────────────────────────── */}
        {snap && (
          <section className="mt-6 rounded-xl border border-hairline bg-card overflow-hidden">
            <div className="border-b border-hairline bg-card2/50 px-5 py-3">
              <h2 className="font-display text-lg font-semibold">What it saw</h2>
              <p className="font-mono text-[0.64rem] text-ink3 mt-1">
                The exact bytes the model was handed — identical for every bot in the same hour
              </p>
            </div>
            <div className="px-6 py-5 space-y-6">
              {/* Wallet State */}
              <div>
                <h3 className="font-mono text-[0.7rem] uppercase tracking-wider text-ink3 mb-3">Wallet State</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-card2/50 p-4">
                    <div className="font-mono text-[0.64rem] text-ink3">Total Value</div>
                    <div className="font-mono text-lg font-semibold text-ink">
                      {(snap.navLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
                    </div>
                  </div>
                  <div className="rounded-lg bg-card2/50 p-4">
                    <div className="font-mono text-[0.64rem] text-ink3">Idle Cash</div>
                    <div className="font-mono text-lg font-semibold text-ink">
                      {(snap.idleLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
                    </div>
                  </div>
                </div>
              </div>

              {/* Positions */}
              {snap.positions.length > 0 && (
                <div>
                  <h3 className="font-mono text-[0.7rem] uppercase tracking-wider text-ink3 mb-3">
                    Positions ({snap.positions.length})
                  </h3>
                  <div className="rounded-lg border border-hairline overflow-hidden">
                    <table className="w-full font-mono text-sm">
                      <thead className="bg-card2/50">
                        <tr className="text-left text-[0.64rem] text-ink3">
                          <th className="px-4 py-2">Token</th>
                          <th className="px-4 py-2 text-right">Value (SOL)</th>
                          <th className="px-4 py-2 text-right">P&L</th>
                          <th className="px-4 py-2 text-right">Held</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {snap.positions.map((p, i) => (
                          <tr key={i} className="hover:bg-card2/30">
                            <td className="px-4 py-2.5">
                              <div className="font-semibold">{p.symbol}</div>
                              <div className="text-[0.6rem] text-ink3 font-mono">
                                {p.mint.slice(0, 8)}...
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                              {(p.valueLamports / LAMPORTS_PER_SOL).toFixed(4)}
                            </td>
                            <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                              p.pnlPct >= 0 ? 'text-good' : 'text-bad'
                            }`}>
                              {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-ink3">
                              {p.heldHours < 1 ? `${(p.heldHours * 60).toFixed(0)}m` :
                               p.heldHours < 24 ? `${p.heldHours.toFixed(1)}h` :
                               `${(p.heldHours / 24).toFixed(1)}d`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tradeable Tokens */}
              <div>
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="font-mono text-[0.7rem] uppercase tracking-wider text-ink3">
                    Tradeable Tokens ({snap.eligible.length})
                  </h3>
                  <span className="font-mono text-[0.64rem] text-ink3">
                    {snap.eligible.filter(t => t.fresh).length} new launches
                  </span>
                </div>
                
                {snap.eligible.length === 0 ? (
                  <div className="rounded-lg bg-card2/50 p-8 text-center text-sm text-ink3">
                    No tokens available
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto rounded-lg border border-hairline">
                    <table className="w-full font-mono text-xs">
                      <thead className="sticky top-0 bg-card border-b border-hairline">
                        <tr className="text-left">
                          <th className="px-3 py-2 text-ink3">Idx</th>
                          <th className="px-3 py-2 text-ink3">Token</th>
                          <th className="px-3 py-2 text-right text-ink3">Price</th>
                          <th className="px-3 py-2 text-right text-ink3">5m</th>
                          <th className="px-3 py-2 text-right text-ink3">1h</th>
                          <th className="px-3 py-2 text-right text-ink3">24h</th>
                          <th className="px-3 py-2 text-right text-ink3">Vol 1h</th>
                          <th className="px-3 py-2 text-right text-ink3">Liq</th>
                          <th className="px-3 py-2 text-right text-ink3">Mcap</th>
                          <th className="px-3 py-2 text-right text-ink3">Age</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {snap.eligible.map((t) => (
                          <tr key={t.idx} className="hover:bg-card2/30">
                            <td className="px-3 py-2 tabular-nums text-ink3">{t.idx}</td>
                            <td className="px-3 py-2">
                              <div className="font-semibold text-ink">{t.symbol}</div>
                              {t.launchpad && (
                                <span className="text-[0.6rem] text-ink3">{t.launchpad}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-ink">
                              ${t.priceUsd.toPrecision(4)}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums ${
                              t.change5m == null ? 'text-ink3' : t.change5m >= 0 ? 'text-good' : 'text-bad'
                            }`}>
                              {t.change5m == null ? '—' : `${t.change5m >= 0 ? '+' : ''}${t.change5m.toFixed(1)}%`}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums ${
                              t.change1h == null ? 'text-ink3' : t.change1h >= 0 ? 'text-good' : 'text-bad'
                            }`}>
                              {t.change1h == null ? '—' : `${t.change1h >= 0 ? '+' : ''}${t.change1h.toFixed(1)}%`}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums ${
                              t.change24h == null ? 'text-ink3' : t.change24h >= 0 ? 'text-good' : 'text-bad'
                            }`}>
                              {t.change24h == null ? '—' : `${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(1)}%`}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-ink3">
                              {t.vol1hUsd == null ? '—' : `$${Math.round(t.vol1hUsd).toLocaleString()}`}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-ink3">
                              {Math.round(t.liquidityUsd).toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-ink3">
                              {t.mcapUsd ? `$${(t.mcapUsd / 1000).toFixed(0)}K` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-ink3">
                              {t.ageHours == null ? '—' : t.ageHours < 48 ? `${t.ageHours.toFixed(1)}h` : `${Math.round(t.ageHours / 24)}d`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Lessons */}
              {snap.lessons.length > 0 && (
                <div>
                  <h3 className="font-mono text-[0.7rem] uppercase tracking-wider text-ink3 mb-3">
                    Lessons from Past Reflections
                  </h3>
                  <ul className="space-y-2">
                    {snap.lessons.map((lesson, i) => (
                      <li key={i} className="rounded-lg bg-gold/5 px-4 py-3 text-sm text-ink2">
                        {lesson}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recent Decisions */}
              {snap.recent.length > 0 && (
                <div>
                  <h3 className="font-mono text-[0.7rem] uppercase tracking-wider text-ink3 mb-3">
                    Recent Decisions & Outcomes
                  </h3>
                  <ul className="space-y-2">
                    {snap.recent.map((r, i) => (
                      <li key={i} className="rounded-lg bg-card2/50 px-4 py-3">
                        <div className="font-mono text-[0.64rem] text-ink3 mb-1">
                          {new Date(r.ts).toISOString().slice(5, 16).replace("T", " ")}
                        </div>
                        <p className="text-sm text-ink2 line-clamp-2">{r.rationale}</p>
                        <div className="mt-1 font-mono text-[0.64rem] text-ink3">
                          → {r.outcome ?? "no trades"}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </Scroller>
  );
}
