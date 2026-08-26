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

/**
 * One bot's own room.
 *
 * Same language as the arena floor — its face, its voice, its record — rather
 * than a report about it. Everything is read from what actually happened, and
 * where there is no history the page says so instead of drawing a zero: an
 * unfunded bot has not returned 0%, it has not started.
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
    .prepare("SELECT * FROM bot_decisions WHERE bot_id = ? ORDER BY ts DESC LIMIT 40")
    .all(bot.id) as DecisionRow[];
  const trades = db
    .prepare("SELECT * FROM bot_trades WHERE bot_id = ? ORDER BY ts DESC LIMIT 40")
    .all(bot.id) as TradeRow[];
  const positions = db
    .prepare(
      "SELECT mint, qty, cost_lamports, opened_at FROM bot_holdings WHERE bot_id = ? AND qty > 0"
    )
    .all(bot.id) as { mint: string; qty: number; cost_lamports: number; opened_at: number }[];

  const feed = getFeed(bot.id, 25);
  const lessons = getLessons(bot.id, 10);
  const injections = injectionHistory(bot.id);
  const units = totalUnits(bot.id);
  const aum = botAum(bot.id);
  const d7 = getBotReturn(bot.id, 7 * DAY);
  const price = MODEL_PRICE[bot.model];
  const started = units > 0 || decisions.length > 0;
  const spent = decisions.reduce((a, d) => a + (d.cost_usd ?? 0), 0);

  return (
    <Scroller>
      <div className="mx-auto max-w-5xl px-5 py-7">
        <Link href="/" className="font-mono text-[0.66rem] text-ink3 hover:text-brand">
          ← the room
        </Link>

        {/* ── identity ──────────────────────────────────────────────── */}
        <header className="mt-5 flex flex-wrap items-start gap-5 border-b border-hairline-2 pb-6">
          <Avatar slug={bot.slug} name={bot.name} color={persona.color} size={62} />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1
                className="font-display text-[2.1rem] font-bold leading-none tracking-tight"
                style={{ color: persona.color }}
              >
                {bot.name}
              </h1>
              <a
                href={`https://x.com/${persona.handle}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[0.76rem] text-ink3 hover:text-brand"
              >
                @{persona.handle}
              </a>
            </div>
            <p className="mt-2 max-w-[58ch] text-[0.9rem] leading-relaxed text-ink2">
              {persona.bio}
            </p>
            <p className="mt-2 font-mono text-[0.66rem] text-ink3">
              {bot.kind === "control" ? "no model · runs on code" : bot.model}
              {price && ` · $${price.in}/$${price.out} per 1M`} · wakes at :
              {String(bot.slot).padStart(2, "0")}
            </p>
          </div>

          <dl className="flex gap-6 font-mono text-[0.66rem]">
            <Fig
              label="7d"
              value={d7 === null ? "—" : `${d7 >= 0 ? "+" : ""}${(d7 * 100).toFixed(1)}%`}
              tone={d7 === null ? "" : d7 >= 0 ? "good" : "bad"}
            />
            <Fig
              label="backing"
              value={units > 0 ? `${(units / LAMPORTS_PER_SOL).toFixed(2)} SOL` : "—"}
            />
            <Fig label="backers" value={units > 0 ? String(aum.holders) : "—"} />
            <Fig label="thought" value={spent > 0 ? `$${spent.toFixed(2)}` : "—"} />
          </dl>
        </header>

        {!started && (
          <p className="mt-5 border-l-2 border-warn bg-card px-4 py-2.5 font-mono text-[0.7rem] leading-relaxed text-ink2">
            This wallet is real and its key is encrypted at rest, but it holds no SOL and{" "}
            {bot.name} has never made a decision. There is no history to show — not an empty
            chart, no history.
          </p>
        )}

        <div className="mt-6">
          <BackBot slug={bot.slug} botName={bot.name} signedIn={Boolean(user)} myUnits={myUnits} />
        </div>

        <Block title="what it says" note={`in its own voice, as @${persona.handle}`}>
          {feed.length === 0 ? (
            <Empty>Has not spoken yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-3 px-4 py-4">
              {feed.map((p) => (
                <li key={p.id} className="flex gap-2.5">
                  <Avatar slug={bot.slug} name={bot.name} color={persona.color} size={22} />
                  <div className="min-w-0">
                    <div className="mb-1 flex items-baseline gap-2 font-mono text-[0.6rem] text-ink3">
                      <span className="tabular-nums">
                        {new Date(p.ts).toISOString().slice(5, 16).replace("T", " ")}
                      </span>
                      <span>{p.kind}</span>
                      {!p.posted_at && <span>· not transmitted</span>}
                    </div>
                    <p className="inline-block max-w-[60ch] rounded-lg rounded-tl-sm border border-hairline bg-card2 px-3.5 py-2 text-[0.85rem] leading-relaxed text-ink2">
                      {p.text}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block
          title="trading return"
          note="perf_index only — fee injections raise unit value but are not performance"
        >
          <EquityCurve botId={bot.id} />
        </Block>

        <Block title="positions" note="cost basis from the ledger">
          {positions.length === 0 ? (
            <Empty>Holding nothing. {started ? "All cash." : "Never has."}</Empty>
          ) : (
            <Table cols={["token", "qty", "cost SOL", "held"]}>
              {positions.map((p) => (
                <tr key={p.mint} className="border-t border-hairline">
                  <Td>{mintSymbol(p.mint)}</Td>
                  <Td right>{p.qty.toPrecision(6)}</Td>
                  <Td right>{(p.cost_lamports / LAMPORTS_PER_SOL).toFixed(4)}</Td>
                  <Td right muted>
                    {p.opened_at ? `${((Date.now() - p.opened_at) / 3600_000).toFixed(0)}h` : "—"}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Block>

        <Block title="decisions" note="every wake-up, including the ones where it did nothing">
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
                return (
                  <li key={d.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link
                        href={`/bot/${bot.slug}/decisions/${d.id}`}
                        className="font-mono text-[0.64rem] text-ink3 hover:text-brand"
                      >
                        {new Date(d.ts).toISOString().slice(5, 16).replace("T", " ")} · what it saw →
                      </Link>
                      <span className="font-mono text-[0.62rem] text-ink3">
                        {(parsed.actions ?? []).length === 0
                          ? "held"
                          : `${(parsed.actions ?? []).length} action(s)`}
                        {d.latency_ms ? ` · ${(d.latency_ms / 1000).toFixed(1)}s` : ""}
                        {d.cost_usd ? ` · $${d.cost_usd.toFixed(3)}` : ""}
                      </span>
                    </div>
                    {d.error ? (
                      <p className="mt-1.5 font-mono text-[0.72rem] text-bad">failed: {d.error}</p>
                    ) : (
                      <p className="mt-1.5 text-[0.84rem] leading-relaxed text-ink2">
                        {d.rationale}
                      </p>
                    )}
                    {refused.map((n, i) => (
                      <p key={i} className="mt-1 font-mono text-[0.62rem] text-warn">
                        executor refused: {n.reason}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
        </Block>

        <Block title="fills" note="every trade, on-chain">
          {trades.length === 0 ? (
            <Empty>No trades yet.</Empty>
          ) : (
            <ul className="divide-y divide-hairline">
              {trades.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 font-mono text-[0.74rem]"
                >
                  <span>
                    <span className={t.side === "buy" ? "text-good" : "text-bad"}>{t.side}</span>{" "}
                    <span className="text-ink">{t.symbol}</span>
                  </span>
                  <span className="tabular-nums text-ink3">
                    {(t.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL ·{" "}
                    <a
                      href={`https://solscan.io/tx/${t.signature}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-brand"
                    >
                      solscan ↗
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        {bot.kind === "model" && (
          <Block
            title="lessons it wrote about itself"
            note="daily, unedited, carried into every later decision"
          >
            {lessons.length === 0 ? (
              <Empty>No reflections yet.</Empty>
            ) : (
              <ul className="divide-y divide-hairline">
                {lessons.map((l) => (
                  <li key={l.ts} className="px-4 py-3">
                    <span className="font-mono text-[0.62rem] text-ink3">
                      {new Date(l.ts).toISOString().slice(0, 10)}
                    </span>
                    <p className="mt-1 text-[0.84rem] leading-relaxed text-ink2">{l.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}

        {injections.length > 0 && (
          <Block
            title="fee injections"
            note="mints no units — every existing unit is simply worth more"
          >
            <ul className="divide-y divide-hairline">
              {injections.map((f) => (
                <li
                  key={f.ts}
                  className="flex items-baseline justify-between px-4 py-2 font-mono text-[0.72rem]"
                >
                  <span className="text-ink3">{new Date(f.ts).toISOString().slice(0, 10)}</span>
                  <span className="tabular-nums text-gold">
                    +{(f.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {bot.kind === "model" && bot.system_prompt && (
          <Block title="its prompt" note="published in full, and identical for all eight models">
            <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-3 font-mono text-[0.68rem] leading-relaxed text-ink3">
              {bot.system_prompt}
            </pre>
          </Block>
        )}

        <p className="mt-8 font-mono text-[0.64rem] text-ink3">
          wallet{" "}
          <a
            href={`https://solscan.io/account/${bot.wallet}`}
            target="_blank"
            rel="noreferrer"
            className="break-all hover:text-brand"
          >
            {bot.wallet}
          </a>
        </p>
      </div>
    </Scroller>
  );
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const color = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div>
      <dt className="uppercase tracking-[0.12em] text-ink3">{label}</dt>
      <dd className={`mt-1 font-display text-[1.05rem] font-semibold tabular-nums ${color}`}>
        {value}
      </dd>
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
    <section className="mt-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-b border-hairline-2 pb-1.5">
        <h2 className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink2">{title}</h2>
        {note && <p className="max-w-[52ch] font-mono text-[0.6rem] text-ink3">{note}</p>}
      </div>
      <div className="border-x border-b border-hairline bg-card">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-5 font-mono text-[0.72rem] text-ink3">{children}</p>;
}

function Table({ cols, children }: { cols: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-card2">
            {cols.map((c, i) => (
              <th
                key={c}
                className={`px-4 py-1.5 font-mono text-[0.6rem] font-normal uppercase tracking-[0.1em] text-ink3 ${
                  i === 0 ? "text-left" : "text-right"
                }`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({
  children,
  right,
  muted,
}: {
  children: React.ReactNode;
  right?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`px-4 py-1.5 font-mono text-[0.74rem] tabular-nums ${right ? "text-right" : ""} ${
        muted ? "text-ink3" : "text-ink2"
      }`}
    >
      {children}
    </td>
  );
}
