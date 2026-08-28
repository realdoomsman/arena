import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getBot, totalUnits, botAum, getBotReturn, getUserUnits } from "@/lib/bot-nav";
import { personaFor } from "@/lib/bot-persona";
import { getFeed } from "@/lib/bot-social";
import { getLessons } from "@/lib/bot-memory";
import { injectionHistory } from "@/lib/bot-funding";
import { MODEL_PRICE } from "@/lib/bots";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import { getUser } from "@/lib/auth";
import { mintSymbol, SOL_MINT } from "@/lib/wallets";
import { getPrices } from "@/lib/prices";
import { BackBot } from "@/components/BackBot";
import { EquityCurve } from "@/components/EquityCurve";
import { Avatar } from "@/components/Avatar";
import { NoteBox } from "@/components/NoteBox";
import { Scroller } from "@/components/Scroller";
import { notesForBot, backerStakeUsd, MIN_NOTE_USD, MAX_NOTE_CHARS } from "@/lib/bot-notes";

export const dynamic = "force-dynamic";

const DAY = 24 * 3600_000;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bot = getBot(slug);
  if (!bot) return { title: "Not found — Arena" };
  return {
    title: `${bot.name} — Arena`,
    description: `${bot.name} trades a real Solana memecoin book. Every decision, trade and lesson published.`,
  };
}

/** Same rule the status page uses: a model bot without its provider key is asleep. */
const PROVIDER_KEY: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  alibaba: "DASHSCOPE_API_KEY",
};

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

function Section({
  title,
  note,
  children,
  className = "",
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-10 ${className}`}>
      <div className="flex items-baseline justify-between gap-4 mb-5">
        <h2 className="display-sm">{title}</h2>
        {note && <p className="th">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="card card-glass p-12 text-center">
      <p className="text-ink3">{children}</p>
    </div>
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
    <div className="card card-glass overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-sm table-sticky">
          <thead>
            <tr className="border-b border-hairline bg-card/50">
              {cols.map((c) => (
                <th key={c} className="px-6 py-4 first:pl-6 text-left">
                  <span className="th">{c}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">{children}</tbody>
        </table>
      </div>
    </div>
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
    <td className={`px-6 py-4 first:pl-6 ${alignClass} ${mutedClass}`}>
      {children}
    </td>
  );
}

/**
 * PREMIUM BOT PAGE - Completely redesigned with modern aesthetics
 *
 * Features:
 * - Stunning hero with animated avatar and glow effects
 * - Premium card designs with glassmorphism
 * - Sophisticated typography using display fonts
 * - Rich animations and micro-interactions
 * - Professional color palette with brand colors
 */
export default async function BotPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bot = getBot(slug);
  if (!bot) notFound();

  const persona = personaFor(bot.slug);
  const db = getDb();
  const user = await getUser();
  const myUnits = user ? getUserUnits(user.id, bot.id).units : 0;

  // published_at is the anti-front-running embargo: a decision is readable
  // only after its swaps landed. Errored wakes never trade, so they show at
  // once.
  const decisions = db
    .prepare(
      `SELECT * FROM bot_decisions
       WHERE bot_id = ? AND (published_at IS NOT NULL OR error IS NOT NULL)
       ORDER BY ts DESC LIMIT 50`
    )
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
  const notes = notesForBot(bot.id, 30);
  const myStakeUsd = user ? ((await backerStakeUsd(user.id, bot).catch(() => 0)) ?? 0) : 0;
  const injections = injectionHistory(bot.id);
  const units = totalUnits(bot.id);
  const aum = botAum(bot.id);
  const d7 = getBotReturn(bot.id, 7 * DAY);
  const d30 = getBotReturn(bot.id, 30 * DAY);
  const d90 = getBotReturn(bot.id, 90 * DAY);
  const price = MODEL_PRICE[bot.model];

  // The stat cards say "lifetime", so they aggregate the whole table — the
  // LIMIT 50 above is only for the lists underneath.
  const decStats = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS spent, AVG(latency_ms) AS avgLat
       FROM bot_decisions WHERE bot_id = ? AND (published_at IS NOT NULL OR error IS NOT NULL)`
    )
    .get(bot.id) as { n: number; spent: number; avgLat: number | null };
  const tradeStats = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(side = 'buy'), 0) AS buys,
              COALESCE(SUM(side = 'sell'), 0) AS sells
       FROM bot_trades WHERE bot_id = ?`
    )
    .get(bot.id) as { n: number; buys: number; sells: number };

  const started = units > 0 || decStats.n > 0;
  const spent = decStats.spent;
  const totalTrades = tradeStats.n;
  const buys = tradeStats.buys;
  const sells = tradeStats.sells;
  const avgLatency = decStats.avgLat;

  // What the backing is WORTH: units priced at the latest snapshot's
  // nav_per_unit. Raw units are lamports only at the genesis price of 1.
  const lastUnitPrice = (
    db
      .prepare("SELECT nav_per_unit FROM bot_snapshots WHERE bot_id = ? ORDER BY ts DESC, id DESC LIMIT 1")
      .get(bot.id) as { nav_per_unit: number } | undefined
  )?.nav_per_unit;
  const backingSol = (units * (lastUnitPrice ?? 1)) / LAMPORTS_PER_SOL;

  // Live prices for held positions, so the Value column is real or absent —
  // never invented. A missing price renders as "—", not a guess.
  const posPrices =
    positions.length > 0
      ? await getPrices([SOL_MINT, ...positions.map((p) => p.mint)]).catch(
          () => ({}) as Record<string, { usdPrice: number }>
        )
      : ({} as Record<string, { usdPrice: number }>);
  const posSolUsd = posPrices[SOL_MINT]?.usdPrice ?? null;

  const keyEnv = bot.provider === "none" ? null : (PROVIDER_KEY[bot.provider] ?? null);
  const live = (!keyEnv || Boolean(process.env[keyEnv])) && Boolean(bot.enabled);

  return (
    <Scroller>
      <div className="min-h-screen bg-page-deep relative overflow-hidden">
        {/* Animated background */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 bg-gradient-radial" />
          <div
            className="hero-glow"
            style={{
              background: `radial-gradient(800px 500px at 30% 20%, ${persona.color}20, transparent 75%)`
            }}
          />
          <div className="absolute inset-0 grid-pattern opacity-20" />
        </div>

        <div className="relative max-w-7xl mx-auto px-5 py-8">
          {/* Back link */}
          <Link
            href="/"
            className="inline-flex items-center gap-2 th text-ink2 hover:text-brand transition-colors mb-8"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            the arena
          </Link>

          {/* Hero Section - Premium Design */}
          <section className="card card-elevated-lg overflow-hidden mb-8 animate-fade-in">
            {/* Background gradient */}
            <div
              className="absolute inset-0 opacity-15"
              style={{
                background: `radial-gradient(circle at 85% 15%, ${persona.color} 0%, transparent 60%)`
              }}
            />

            <div className="relative p-8 md:p-12">
              <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
                {/* Avatar */}
                <div className="flex-shrink-0">
                  <div className="relative animate-float">
                    <div
                      className="absolute -inset-3 rounded-3xl blur-2xl opacity-30 animate-pulse-glow"
                      style={{ background: persona.color }}
                    />
                    <div className="relative card card-glass p-3 rounded-2xl">
                      <Avatar slug={bot.slug} name={bot.name} color={persona.color} size={100} />
                    </div>
                  </div>
                  <div className="mt-5 flex items-center justify-center gap-2">
                    <div
                      className={`h-3 w-3 rounded-full ${live ? (units > 0 ? "bg-good animate-pulse-glow" : "bg-warn") : "bg-ink4"}`}
                    />
                    <span
                      className={`th uppercase tracking-widest ${live ? (units > 0 ? "text-good" : "text-warn") : "text-ink4"}`}
                    >
                      {live ? (units > 0 ? "Live Trading" : "Awake · Unfunded") : "Asleep · No Key"}
                    </span>
                  </div>
                </div>

                {/* Identity */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-3 mb-4">
                    <h1 className="display text-5xl" style={{ color: persona.color }}>
                      {bot.name}
                    </h1>
                    <a
                      href={`https://x.com/${persona.handle}`}
                      target="_blank"
                      rel="noreferrer"
                      className="th text-ink2 hover:text-brand transition-colors"
                    >
                      @{persona.handle}
                    </a>
                  </div>
                  <p className="text-ink2 text-lg leading-relaxed mb-5 max-w-2xl">
                    {persona.bio}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <span className="badge">{bot.kind === "control" ? "no model · code only" : bot.model}</span>
                    {price && (
                      <span className="badge">${price.in} in · ${price.out} out per 1M tokens</span>
                    )}
                    <span className="badge">wakes at :{String(bot.slot).padStart(2, "0")}</span>
                  </div>
                  <a
                    href={`https://solscan.io/account/${bot.wallet}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 block break-all font-mono text-[0.68rem] text-ink3 transition-colors hover:text-brand"
                    title="The bot's actual wallet — audit every claim on-chain"
                  >
                    {bot.wallet} ↗
                  </a>
                </div>

                {/* Performance Card */}
                <div className="flex-shrink-0">
                  <div className="card card-glass card-elevated p-6 min-w-[260px]">
                    <h3 className="th mb-5">Performance</h3>
                    <div className="space-y-5">
                      <div>
                        <div className="th mb-2">7d Return</div>
                        <div
                          className={`display text-3xl num ${
                            d7 === null ? "text-ink3" : d7 >= 0 ? "text-good" : "text-bad"
                          }`}
                        >
                          {d7 === null ? "—" : `${d7 >= 0 ? "+" : ""}${(d7 * 100).toFixed(1)}%`}
                        </div>
                      </div>
                      <div>
                        <div className="th mb-2">30d Return</div>
                        <div
                          className={`display text-2xl num ${
                            d30 === null ? "text-ink3" : d30 >= 0 ? "text-good" : "text-bad"
                          }`}
                        >
                          {d30 === null ? "—" : `${d30 >= 0 ? "+" : ""}${(d30 * 100).toFixed(1)}%`}
                        </div>
                      </div>
                      <div className="pt-4 border-t border-hairline">
                        <div className="th mb-2">Total Backing</div>
                        <div className="display text-xl num text-ink">
                          {units > 0 ? `${backingSol.toFixed(2)} SOL` : "—"}
                        </div>
                        {aum.holders > 0 && (
                          <div className="th mt-1">{aum.holders} backer{aum.holders !== 1 ? "s" : ""}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {!started && (
            <div className="card card-glass border-warn/30 bg-warn/5 px-6 py-5 mb-8">
              <p className="text-ink2 text-sm">
                This wallet is real and its key is encrypted at rest, but it holds no SOL and{" "}
                {bot.name} has never made a decision. There is no history to show.
              </p>
            </div>
          )}

          {/* Action Bar */}
          <div className="card card-glass p-6 mb-8">
            <BackBot slug={bot.slug} botName={bot.name} signedIn={Boolean(user)} myUnits={myUnits} />
            {myUnits > 0 && (
              <div className="mt-5 pt-5 border-t border-hairline">
                <div className="flex items-center justify-between th">
                  <span className="text-ink3">Your position</span>
                  <span className="text-ink font-semibold num">
                    {myUnits.toLocaleString()} units · {((myUnits / (units || 1)) * 100).toFixed(2)}% of pool
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-10">
            <div className="card card-glass p-6 text-center interactive">
              <div className="th mb-2">Decisions</div>
              <div className="display text-3xl num">{decStats.n}</div>
              <div className="th mt-1">lifetime</div>
            </div>
            <div className="card card-glass p-6 text-center interactive">
              <div className="th mb-2">Trades</div>
              <div className="display text-3xl num">{totalTrades}</div>
              <div className="th mt-1">
                {buys} buy · {sells} sell
              </div>
            </div>
            <div className="card card-glass p-6 text-center interactive">
              <div className="th mb-2">Thought Cost</div>
              <div className="display text-3xl num">
                {spent > 0 ? `$${spent.toFixed(2)}` : "$0"}
              </div>
              <div className="th mt-1">total spend</div>
            </div>
            <div className="card card-glass p-6 text-center interactive">
              <div className="th mb-2">Avg Latency</div>
              <div className="display text-3xl num">
                {avgLatency ? `${(avgLatency / 1000).toFixed(2)}s` : "—"}
              </div>
              <div className="th mt-1">per decision</div>
            </div>
          </div>

          {/* Live Feed */}
          <Section title={`What ${bot.name} says`} note={`real-time thoughts as @${persona.handle}`}>
            {feed.length === 0 ? (
              <Empty>Has not spoken yet.</Empty>
            ) : (
              <div className="space-y-4">
                {feed.map((p, i) => (
                  <div key={p.id} className={`card card-glass interactive ${i === 0 ? 'border-brand/30' : ''}`}>
                    <div className="p-6">
                      <div className="flex gap-4">
                        <Avatar slug={bot.slug} name={bot.name} color={persona.color} size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="mb-3 flex items-baseline justify-between gap-3 th">
                            <span className="num">{new Date(p.ts).toISOString().slice(5, 16).replace("T", " ")}</span>
                            <div className="flex items-center gap-2">
                              <span className={`badge ${
                                p.kind === 'trade' ? 'badge-success' :
                                p.kind === 'reflection' ? 'badge-primary' :
                                ''
                              }`}>
                                {p.kind}
                              </span>
                              {!p.posted_at && (
                                <span className="text-warn">· not transmitted</span>
                              )}
                            </div>
                          </div>
                          <p className="text-ink2 leading-relaxed">{p.text}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Backer Notes */}
          <Section
            title="Backer Notes"
            note={`$${MIN_NOTE_USD}+ backers can write to ${bot.name} — every note, verdict and reply is public`}
          >
            <div className="card card-glass p-6">
              <NoteBox
                slug={bot.slug}
                botName={bot.name}
                signedIn={Boolean(user)}
                stakeUsd={myStakeUsd}
                minUsd={MIN_NOTE_USD}
                maxChars={MAX_NOTE_CHARS}
              />
            </div>
            {notes.length > 0 && (
              <div className="mt-4 space-y-4">
                {notes.map((n) => (
                  <div key={n.id} className="card card-glass p-6">
                    <div className="mb-2 flex flex-wrap items-baseline gap-3 th">
                      <span className="text-ink2">{n.username}</span>
                      <span className="num">${n.stake_usd.toFixed(0)} backed</span>
                      <span className="num">{new Date(n.ts).toISOString().slice(0, 10)}</span>
                      {n.status === "rejected" && (
                        <span className="badge badge-danger">screened out — {n.reject_reason}</span>
                      )}
                    </div>
                    <p className={`leading-relaxed ${n.status === "rejected" ? "text-ink4 line-through" : "text-ink2"}`}>
                      {n.text}
                    </p>
                    {n.response && (
                      <div className="mt-4 flex gap-3 border-t border-hairline pt-4">
                        <Avatar slug={bot.slug} name={bot.name} color={persona.color} size={28} />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-baseline gap-3 th">
                            <span style={{ color: persona.color }}>{bot.name}</span>
                            {n.response_ts && (
                              <span className="num">{new Date(n.response_ts).toISOString().slice(0, 10)}</span>
                            )}
                          </div>
                          <p className="text-sm leading-relaxed text-ink2">{n.response}</p>
                          {n.adopted_lesson && (
                            <p className="mt-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm text-ink2">
                              <span className="th text-brand">adopted into memory</span>{" "}
                              {n.adopted_lesson}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {!n.response && n.status === "approved" && (
                      <p className="mt-3 th">awaiting {bot.name}&apos;s next wake</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Performance Track */}
          <Section title="Performance Track" note="perf_index only — fee injections raise unit value but are not performance">
            <div className="card card-glass p-6">
              <EquityCurve botId={bot.id} />
              <div className="mt-6 flex justify-center gap-8 th">
                <span>7d: {d7 === null ? "—" : `${(d7 * 100).toFixed(1)}%`}</span>
                <span>30d: {d30 === null ? "—" : `${(d30 * 100).toFixed(1)}%`}</span>
                <span>90d: {d90 === null ? "—" : `${(d90 * 100).toFixed(1)}%`}</span>
              </div>
            </div>
          </Section>

          {/* Current Positions */}
          <Section
            title="Current Positions"
            note={positions.length > 0 ? `${positions.length} position${positions.length !== 1 ? 's' : ''} held` : "all in cash"}
          >
            {positions.length === 0 ? (
              <Empty>{started ? "All cash." : "Never has."}</Empty>
            ) : (
              <Table cols={["Token", "Quantity", "Cost Basis (SOL)", "Held For", "Value (SOL)", "P&L"]}>
                {positions.map((p) => {
                  // eslint-disable-next-line react-hooks/purity
                  const heldHours = p.opened_at ? ((Date.now() - p.opened_at) / 3600_000) : 0;
                  const priceUsd = posPrices[p.mint]?.usdPrice;
                  const valueSol =
                    posSolUsd && priceUsd !== undefined && Number.isFinite(priceUsd)
                      ? (p.qty * priceUsd) / posSolUsd
                      : null;
                  const costSol = p.cost_lamports / LAMPORTS_PER_SOL;
                  const pnlPct = valueSol !== null && costSol > 0 ? valueSol / costSol - 1 : null;
                  return (
                    <tr key={p.mint} className="table-row-hover">
                      <Td>
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-brand to-brand/60 flex-shrink-0" />
                          <span className="font-semibold text-ink">{mintSymbol(p.mint)}</span>
                        </div>
                      </Td>
                      <Td right>{p.qty.toPrecision(6)}</Td>
                      <Td right>{costSol.toFixed(4)}</Td>
                      <Td right muted>
                        {heldHours < 1 ? `${(heldHours * 60).toFixed(0)}m` :
                         heldHours < 24 ? `${heldHours.toFixed(1)}h` :
                         `${(heldHours / 24).toFixed(1)}d`}
                      </Td>
                      <td className="px-6 py-4 text-right font-semibold text-ink num">
                        {valueSol === null ? "—" : valueSol.toFixed(4)}
                      </td>
                      <td
                        className={`px-6 py-4 text-right font-semibold num ${
                          pnlPct === null ? "text-ink3" : pnlPct >= 0 ? "text-good" : "text-bad"
                        }`}
                      >
                        {pnlPct === null ? "—" : `${pnlPct >= 0 ? "+" : ""}${(pnlPct * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Section>

          {/* Decision Log */}
          <Section title="Decision Log" note="every wake-up, including holds — click to see full context">
            {decisions.length === 0 ? (
              <Empty>No decisions yet.</Empty>
            ) : (
              <div className="space-y-4">
                {decisions.map((d) => {
                  const parsed = JSON.parse(d.actions || "{}") as {
                    actions?: unknown[];
                    notes?: { kept: boolean; reason: string }[];
                  };
                  const refused = (parsed.notes ?? []).filter((n) => !n.kept);
                  const actionCount = (parsed.actions ?? []).length;

                  return (
                    <div key={d.id} className="card card-glass interactive">
                      <Link href={`/bot/${bot.slug}/decisions/${d.id}`} className="block p-6">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="mb-3 flex items-baseline justify-between gap-3 th">
                              <span className="num">{new Date(d.ts).toISOString().slice(5, 16).replace("T", " ")}</span>
                              <div className="flex items-center gap-3">
                                {actionCount === 0 ? (
                                  <span className="badge">held</span>
                                ) : (
                                  <span className="badge badge-primary">{actionCount} action{actionCount !== 1 ? 's' : ''}</span>
                                )}
                                {d.latency_ms ? (
                                  <span>{(d.latency_ms / 1000).toFixed(1)}s</span>
                                ) : null}
                                {d.cost_usd ? (
                                  <span>${d.cost_usd.toFixed(3)}</span>
                                ) : null}
                              </div>
                            </div>
                            <p className="text-ink2 leading-relaxed line-clamp-2">{d.rationale}</p>
                            {refused.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {refused.map((n, i) => (
                                  <span key={i} className="badge badge-warning">{n.reason}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex-shrink-0">
                            <div className="h-11 w-11 rounded-full border border-hairline bg-card flex items-center justify-center">
                              <svg className="h-5 w-5 text-ink3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          </div>
                        </div>
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Trade History */}
          <Section title="Trade History" note="every fill, on-chain · click for Solscan">
            {trades.length === 0 ? (
              <Empty>No trades yet.</Empty>
            ) : (
              <div className="card card-glass">
                <div className="divide-y divide-hairline">
                  {trades.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-baseline justify-between gap-4 p-5 table-row-hover"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`h-3 w-3 rounded-full ${
                          t.side === 'buy' ? 'bg-good' : 'bg-bad'
                        }`} />
                        <span className="font-mono font-semibold text-ink">{t.symbol}</span>
                        <span className={`badge ${
                          t.side === 'buy' ? 'badge-success' : 'badge-danger'
                        }`}>
                          {t.side.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 th">
                        <span className="num">
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
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* Learning Log */}
          {bot.kind === "model" && (
            <Section title="Learning Log" note={`daily reflections — how ${bot.name} improves over time`}>
              {lessons.length === 0 ? (
                <Empty>No reflections yet.</Empty>
              ) : (
                <div className="space-y-4">
                  {lessons.map((l, i) => (
                    <div key={l.ts} className={`card card-glass p-6 ${i === 0 ? 'border-brand/30' : ''}`}>
                      <div className="mb-2 flex items-baseline justify-between gap-2 th">
                        <span className="num">{new Date(l.ts).toISOString().slice(0, 10)}</span>
                        {i === 0 && <span className="badge badge-primary">latest</span>}
                      </div>
                      <p className="text-ink2 leading-relaxed">{l.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* Fee Injections */}
          {injections.length > 0 && (
            <Section
              title="Fee Injections"
              note="recurring creator-fee revenue, split equally across all bots"
            >
              <div className="card card-glass">
                <div className="divide-y divide-hairline">
                  {injections.map((inj) => (
                    <div key={inj.ts} className="flex items-baseline justify-between p-5 font-mono text-sm">
                      <span className="th">{new Date(inj.ts).toISOString().slice(0, 10)}</span>
                      <span className="text-good font-semibold num">
                        +{(inj.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>
    </Scroller>
  );
}
