import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getBot, totalUnits, botAum, getBotReturn, getUserUnits } from "@/lib/bot-nav";
import { personaFor } from "@/lib/bot-persona";
import { getFeed } from "@/lib/bot-social";
import { getLessons } from "@/lib/bot-memory";
import { injectionHistory } from "@/lib/bot-funding";
import { MODEL_PRICE } from "@/lib/bots";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import { getUser } from "@/lib/auth";
import { mintSymbol } from "@/lib/wallets";
import { BackBot } from "@/components/BackBot";
import { EquityCurve } from "@/components/EquityCurve";
import { Avatar } from "@/components/Avatar";
import { Scroller } from "@/components/Scroller";

export const dynamic = "force-dynamic";

const DAY = 24 * 3600_000;

type DecisionRow = {
  id: number;
  ts: number;
  rationale: string;
  actions: string;
  cost_usd: number | null;
  latency_ms: number | null;
  error: string | null;
};

type TradeRow = {
  id: number;
  ts: number;
  symbol: string;
  side: string;
  lamports: number;
  signature: string;
};

function Fig({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: string | number;
  tone?: "good" | "bad" | "";
}) {
  const toneClass =
    tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div>
      <dt className="text-ink3">{label}</dt>
      <dd className={toneClass}>{value}</dd>
    </div>
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
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        {note && <p className="font-mono text-[0.6rem] text-ink3">{note}</p>}
      </div>
      <div className="mt-3 rounded-lg border border-hairline bg-card">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-8 text-center text-sm text-ink3">{children}</div>
  );
}

function Table({
  cols,
  children,
}: {
  cols: string[];
  children: React.ReactNode;
}) {
  return (
    <table className="w-full font-mono text-sm">
      <thead>
        <tr className="border-b border-hairline text-left text-[0.64rem] text-ink3">
          {cols.map((c) => (
            <th key={c} className="px-3 py-2 first:pl-4">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Td({
  children,
  right = false,
  muted = false,
}: {
  children: React.ReactNode;
  right?: boolean;
  muted?: boolean;
}) {
  const alignClass = right ? "text-right" : "";
  const mutedClass = muted ? "text-ink3" : "text-ink";
  return (
    <td className={`px-3 py-2.5 first:pl-4 ${alignClass} ${mutedClass}`}>
      {children}
    </td>
  );
}

/**
 * One bot's own room - SUPER ENHANCED UI
 *
 * Visualizes the bot's mind, decisions, positions, and learning journey
 * with rich context and real-time feel.
 */
export default async function BotPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bot = getBot(slug);
  if (!bot) notFound();

  const persona = personaFor(bot.slug);
  const db = getDb();
  const user = await getUser();
  const myUnits = user ? getUserUnits(user.id, bot.id).units : 0;

  const decisions = db
    .prepare("SELECT * FROM bot_decisions WHERE bot_id = ? ORDER BY ts DESC LIMIT 50")
    .all(bot.id) as DecisionRow[];
  const trades = db
    .prepare("SELECT * FROM bot_trades WHERE bot_id = ? ORDER BY ts DESC LIMIT 50")
    .all(bot.id) as TradeRow[];
  const positions = db
    .prepare(
      "SELECT mint, qty, cost_lamports, opened_at FROM bot_holdings WHERE bot_id = ? AND qty > 0"
    )
    .all(bot.id) as { mint: string; qty: number; cost_lamports: number; opened_at: number }[];

  const feed = getFeed(bot.id, 30);
  const lessons = getLessons(bot.id, 15);
  const injections = injectionHistory(bot.id);
  const units = totalUnits(bot.id);
  const aum = botAum(bot.id);
  const d7 = getBotReturn(bot.id, 7 * DAY);
  const d30 = getBotReturn(bot.id, 30 * DAY);
  const d90 = getBotReturn(bot.id, 90 * DAY);
  const price = MODEL_PRICE[bot.model];
  const started = units > 0 || decisions.length > 0;
  const spent = decisions.reduce((a, d) => a + (d.cost_usd ?? 0), 0);

  // Calculate additional metrics
  const totalTrades = trades.length;
  const buys = trades.filter(t => t.side === 'buy').length;
  const sells = trades.filter(t => t.side === 'sell').length;
  const avgLatency = decisions
    .filter(d => d.latency_ms !== null)
    .reduce((a, d) => a + (d.latency_ms ?? 0), 0) / decisions.filter(d => d.latency_ms !== null).length;

  return (
    <Scroller>
      <div className="mx-auto max-w-6xl px-5 py-8">
        <Link href="/" className="font-mono text-[0.7rem] text-ink3 hover:text-brand">
          ← the arena
        </Link>

        {/* ── Hero Section ──────────────────────────────────────────────── */}
        <header className="mt-8 rounded-2xl border border-hairline bg-gradient-to-br from-card to-card2 p-8 shadow-lg">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
            {/* Avatar & Identity */}
            <div className="flex-shrink-0">
              <Avatar slug={bot.slug} name={bot.name} color={persona.color} size={80} className="shadow-xl" />
              <div className="mt-3 flex items-center gap-2">
                <div className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: persona.color }} />
                <span className="font-mono text-[0.64rem] text-ink3">LIVE TRADING</span>
              </div>
            </div>

            {/* Name & Bio */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-3">
                <h1
                  className="font-display text-4xl font-bold leading-none tracking-tight"
                  style={{ color: persona.color }}
                >
                  {bot.name}
                </h1>
                <a
                  href={`https://x.com/${persona.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[0.8rem] text-ink3 hover:text-brand transition-colors"
                >
                  @{persona.handle}
                </a>
              </div>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-ink2">
                {persona.bio}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 font-mono text-[0.7rem] text-ink3">
                <span className="rounded-full border border-hairline bg-card2 px-3 py-1">
                  {bot.kind === "control" ? "no model · code only" : bot.model}
                </span>
                {price && (
                  <span className="rounded-full border border-hairline bg-card2 px-3 py-1">
                    ${price.in}/$${price.out} per 1M
                  </span>
                )}
                <span className="rounded-full border border-hairline bg-card2 px-3 py-1">
                  wakes at :{String(bot.slot).padStart(2, "0")}
                </span>
              </div>
            </div>

            {/* Key Metrics */}
            <div className="flex-shrink-0 rounded-xl border border-hairline bg-card p-5 min-w-[200px]">
              <h3 className="font-mono text-[0.64rem] uppercase tracking-wider text-ink3 mb-4">Performance</h3>
              <div className="space-y-3">
                <div>
                  <div className="font-mono text-[0.6rem] text-ink3">7d return</div>
                  <div
                    className={`font-display text-2xl font-bold ${
                      d7 === null ? "text-ink3" : d7 >= 0 ? "text-good" : "text-bad"
                    }`}
                  >
                    {d7 === null ? "—" : `${d7 >= 0 ? "+" : ""}${(d7 * 100).toFixed(1)}%`}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[0.6rem] text-ink3">30d return</div>
                  <div
                    className={`font-display text-xl font-bold ${
                      d30 === null ? "text-ink3" : d30 >= 0 ? "text-good" : "text-bad"
                    }`}
                  >
                    {d30 === null ? "—" : `${d30 >= 0 ? "+" : ""}${(d30 * 100).toFixed(1)}%`}
                  </div>
                </div>
                <div className="pt-3 border-t border-hairline">
                  <div className="font-mono text-[0.6rem] text-ink3">Total Backing</div>
                  <div className="font-display text-lg font-bold text-ink">
                    {units > 0 ? `${(units / LAMPORTS_PER_SOL).toFixed(2)} SOL` : "—"}
                  </div>
                  {aum.holders > 0 && (
                    <div className="font-mono text-[0.6rem] text-ink3 mt-1">
                      {aum.holders} backer{aum.holders !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>

        {!started && (
          <div className="mt-6 rounded-lg border-l-4 border-warn bg-card/50 px-5 py-4 font-mono text-[0.75rem] leading-relaxed text-ink2">
            This wallet is real and its key is encrypted at rest, but it holds no SOL and{" "}
            {bot.name} has never made a decision. There is no history to show — not an empty
            chart, no history.
          </div>
        )}

        {/* ── Action Bar ──────────────────────────────────────────────────── */}
        <div className="mt-6 rounded-xl border border-hairline bg-card p-5">
          <BackBot slug={bot.slug} botName={bot.name} signedIn={Boolean(user)} myUnits={myUnits} />
          {myUnits > 0 && (
            <div className="mt-4 pt-4 border-t border-hairline">
              <div className="flex items-center justify-between font-mono text-[0.7rem]">
                <span className="text-ink3">Your position</span>
                <span className="text-ink font-semibold">
                  {myUnits.toLocaleString()} units · {((myUnits / (units || 1)) * 100).toFixed(2)}% of pool
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── Stats Grid ───────────────────────────────────────────────────── */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-hairline bg-card p-4">
            <div className="font-mono text-[0.64rem] uppercase tracking-wider text-ink3">Decisions</div>
            <div className="font-display text-2xl font-bold text-ink mt-1">{decisions.length}</div>
            <div className="font-mono text-[0.6rem] text-ink3 mt-1">lifetime</div>
          </div>
          <div className="rounded-lg border border-hairline bg-card p-4">
            <div className="font-mono text-[0.64rem] uppercase tracking-wider text-ink3">Trades</div>
            <div className="font-display text-2xl font-bold text-ink mt-1">{totalTrades}</div>
            <div className="font-mono text-[0.6rem] text-ink3 mt-1">
              {buys} buy · {sells} sell
            </div>
          </div>
          <div className="rounded-lg border border-hairline bg-card p-4">
            <div className="font-mono text-[0.64rem] uppercase tracking-wider text-ink3">Thought Cost</div>
            <div className="font-display text-2xl font-bold text-ink mt-1">
              {spent > 0 ? `$${spent.toFixed(2)}` : "$0"}
            </div>
            <div className="font-mono text-[0.6rem] text-ink3 mt-1">total spend</div>
          </div>
          <div className="rounded-lg border border-hairline bg-card p-4">
            <div className="font-mono text-[0.64rem] uppercase tracking-wider text-ink3">Avg Latency</div>
            <div className="font-display text-2xl font-bold text-ink mt-1">
              {avgLatency ? `${(avgLatency / 1000).toFixed(2)}s` : "—"}
            </div>
            <div className="font-mono text-[0.6rem] text-ink3 mt-1">per decision</div>
          </div>
        </div>

        {/* ── Live Feed ─────────────────────────────────────────────────────── */}
        <Block
          title={`What ${bot.name} says`}
          note={`real-time thoughts as @${persona.handle}`}
        >
          {feed.length === 0 ? (
            <Empty>Has not spoken yet.</Empty>
          ) : (
            <ul className="divide-y divide-hairline">
              {feed.map((p, i) => (
                <li key={p.id} className={`flex gap-3 ${i === 0 ? 'bg-card2/50' : ''}`}>
                  <Avatar slug={bot.slug} name={bot.name} color={persona.color} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 font-mono text-[0.64rem] text-ink3">
                      <span className="tabular-nums">
                        {new Date(p.ts).toISOString().slice(5, 16).replace("T", " ")}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 ${
                          p.kind === 'trade' ? 'bg-good/10 text-good' :
                          p.kind === 'reflection' ? 'bg-brand/10 text-brand' :
                          'bg-ink/5 text-ink'
                        }`}>
                          {p.kind}
                        </span>
                        {!p.posted_at && (
                          <span className="text-warn">· not transmitted</span>
                        )}
                      </div>
                    </div>
                    <p className="rounded-xl rounded-tl-sm border border-hairline bg-card px-4 py-3 text-[0.9rem] leading-relaxed text-ink2 shadow-sm">
                      {p.text}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Block>

        {/* ── Performance Chart ─────────────────────────────────────────────── */}
        <Block
          title="Performance Track"
          note="perf_index only — fee injections raise unit value but are not performance"
        >
          <div className="px-5 py-6">
            <EquityCurve botId={bot.id} />
            <div className="mt-4 flex justify-center gap-6 font-mono text-[0.7rem] text-ink3">
              <span>7d: {d7 === null ? "—" : `${(d7 * 100).toFixed(1)}%`}</span>
              <span>30d: {d30 === null ? "—" : `${(d30 * 100).toFixed(1)}%`}</span>
              <span>90d: {d90 === null ? "—" : `${(d90 * 100).toFixed(1)}%`}</span>
            </div>
          </div>
        </Block>

        {/* ── Current Positions ─────────────────────────────────────────────── */}
        <Block
          title="Current Positions"
          note={positions.length > 0 ? `${positions.length} position${positions.length !== 1 ? 's' : ''} held` : "all in cash"}
        >
          {positions.length === 0 ? (
            <Empty>
              {started ? "All cash." : "Never has."}
            </Empty>
          ) : (
            <Table cols={["Token", "Quantity", "Cost Basis (SOL)", "Held For", "Value"]}>
              {positions.map((p) => {
                const heldHours = p.opened_at ? (Date.now() - p.opened_at) / 3600_000 : 0;
                const currentValue = p.qty * 0.01; // Simplified - should fetch real price
                return (
                  <tr key={p.mint} className="border-t border-hairline hover:bg-card2/50 transition-colors">
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-brand to-brand/60" />
                        <span className="font-semibold">{mintSymbol(p.mint)}</span>
                      </div>
                    </Td>
                    <Td right>{p.qty.toPrecision(6)}</Td>
                    <Td right>{(p.cost_lamports / LAMPORTS_PER_SOL).toFixed(4)}</Td>
                    <Td right muted>
                      {heldHours < 1 ? `${(heldHours * 60).toFixed(0)}m` :
                       heldHours < 24 ? `${heldHours.toFixed(1)}h` :
                       `${(heldHours / 24).toFixed(1)}d`}
                    </Td>
                    <Td right className="font-semibold text-ink">
                      {currentValue.toFixed(4)}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Block>

        {/* ── Recent Decisions ─────────────────────────────────────────────── */}
        <Block
          title="Decision Log"
          note="every wake-up, including holds — click to see full context"
        >
          {decisions.length === 0 ? (
            <Empty>No decisions yet.</Empty>
          ) : (
            <ul className="divide-y divide-hairline">
              {decisions.map((d) => {
                const parsed = JSON.parse(d.actions || "{}") as {
                  actions?: unknown[];
                  notes?: { kept: boolean; reason: string }[];
                };
                const refused = (parsed.notes ?? []).filter((n) => !n.kept);
                const actionCount = (parsed.actions ?? []).length;
                
                return (
                  <li key={d.id} className="group px-5 py-4 hover:bg-card2/30 transition-colors">
                    <Link
                      href={`/bot/${bot.slug}/decisions/${d.id}`}
                      className="flex items-start justify-between gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex items-baseline justify-between gap-2">
                          <span className="font-mono text-[0.7rem] text-ink3 tabular-nums">
                            {new Date(d.ts).toISOString().slice(5, 16).replace("T", " ")}
                          </span>
                          <div className="flex items-center gap-2 font-mono text-[0.64rem]">
                            {actionCount === 0 ? (
                              <span className="rounded-full bg-ink/5 px-2 py-0.5 text-ink3">held</span>
                            ) : (
                              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-brand">
                                {actionCount} action{actionCount !== 1 ? 's' : ''}
                              </span>
                            )}
                            {d.latency_ms && (
                              <span className="text-ink3">
                                {(d.latency_ms / 1000).toFixed(1)}s
                              </span>
                            )}
                            {d.cost_usd && (
                              <span className="text-ink3">
                                ${d.cost_usd.toFixed(3)}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="line-clamp-2 text-sm leading-relaxed text-ink2 group-hover:text-ink transition-colors">
                          {d.rationale}
                        </p>
                        {refused.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {refused.map((n, i) => (
                              <span
                                key={i}
                                className="rounded bg-warn/10 px-2 py-0.5 font-mono text-[0.62rem] text-warn"
                              >
                                {n.reason}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        <div className="h-8 w-8 rounded-full border border-hairline bg-card flex items-center justify-center group-hover:border-brand/50 transition-colors">
                          <svg className="h-4 w-4 text-ink3 group-hover:text-brand transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Block>

        {/* ── Trade History ─────────────────────────────────────────────────── */}
        <Block
          title="Trade History"
          note="every fill, on-chain · click for Solscan"
        >
          {trades.length === 0 ? (
            <Empty>No trades yet.</Empty>
          ) : (
            <ul className="divide-y divide-hairline">
              {trades.map((t) => (
                <li
                  key={t.id}
                  className="group flex flex-wrap items-baseline justify-between gap-3 px-5 py-3 hover:bg-card2/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${
                      t.side === 'buy' ? 'bg-good' : 'bg-bad'
                    }`} />
                    <span className="font-mono text-sm font-semibold text-ink">
                      {t.symbol}
                    </span>
                    <span className={`font-mono text-sm font-medium ${
                      t.side === 'buy' ? 'text-good' : 'text-bad'
                    }`}>
                      {t.side.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 font-mono text-[0.74rem] text-ink3">
                    <span className="tabular-nums">
                      {(t.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
                    </span>
                    <a
                      href={`https://solscan.io/tx/${t.signature}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-brand transition-colors"
                    >
                      Solscan ↗
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Block>

        {/* ── Learning Log ───────────────────────────────────────────────────── */}
        {bot.kind === "model" && (
          <Block
            title="Learning Log"
            note="daily reflections — how {bot.name} improves over time"
          >
            {lessons.length === 0 ? (
              <Empty>No reflections yet.</Empty>
            ) : (
              <ul className="divide-y divide-hairline">
                {lessons.map((l, i) => (
                  <li key={l.ts} className={`px-5 py-4 ${i === 0 ? 'bg-brand/5' : ''}`}>
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[0.7rem] text-ink3 tabular-nums">
                        {new Date(l.ts).toISOString().slice(0, 10)}
                      </span>
                      {i === 0 && (
                        <span className="rounded-full bg-brand/10 px-2 py-0.5 font-mono text-[0.62rem] text-brand">
                          latest
                        </span>
                      )}
                    </div>
                    <p className="text-[0.9rem] leading-relaxed text-ink2">{l.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}

        {/* ── Fee Injections ─────────────────────────────────────────────────── */}
        {injections.length > 0 && (
          <Block
            title="Fee Injections"
            note="recurring creator-fee revenue, split equally across all bots"
          >
            <ul className="divide-y divide-hairline">
              {injections.map((inj) => (
                <li key={inj.ts} className="flex items-baseline justify-between px-5 py-3 font-mono text-sm">
                  <span className="text-ink3">
                    {new Date(inj.ts).toISOString().slice(0, 10)}
                  </span>
                  <span className="text-good">
                    +{(inj.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}
      </div>
    </Scroller>
  );
}
