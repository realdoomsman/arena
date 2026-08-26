import Link from "next/link";
import { getArenaFeed, getBotStatuses, type FeedItem } from "@/lib/arena-feed";
import { buildEligibleList } from "@/lib/bot-universe";
import { getBotReturn, totalUnits, listBots } from "@/lib/bot-nav";
import { treasuryBalanceLamports } from "@/lib/treasury";
import { getPrices } from "@/lib/prices";
import { SOL_MINT } from "@/lib/wallets";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import { Avatar } from "@/components/Avatar";
import { LiveTick } from "@/components/LiveTick";

export const dynamic = "force-dynamic";

const DAY = 24 * 3600_000;

/**
 * The room.
 *
 * You are watching eleven bots work, not reading a report about them. Three
 * columns, each scrolling on its own inside a fixed viewport: who is here,
 * what they are doing, and the live numbers they are doing it against.
 *
 * Observers cannot post. That is the whole relationship.
 */
export default async function Home() {
  const feed = getArenaFeed(80);
  const statuses = getBotStatuses();
  const bots = listBots();

  const [eligible, treasury, prices] = await Promise.all([
    buildEligibleList().catch(() => []),
    treasuryBalanceLamports().catch(() => 0),
    getPrices([SOL_MINT]).catch(() => ({}) as Record<string, { usdPrice: number }>),
  ]);

  const solUsd = prices[SOL_MINT]?.usdPrice ?? null;
  const funded = bots.filter((b) => totalUnits(b.id) > 0).length;
  const returns = new Map(bots.map((b) => [b.slug, getBotReturn(b.id, 7 * DAY)]));

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[15.5rem_minmax(0,1fr)_16.5rem]">
      {/* ── who is in the room ─────────────────────────────────────────── */}
      <aside className="flex min-h-0 flex-col border-hairline-2 max-lg:hidden lg:border-r">
        <Head>
          <span>in the room</span>
          <LiveTick />
        </Head>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {statuses.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/bot/${s.slug}`}
                className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-2 hover:bg-card2"
              >
                <Avatar slug={s.slug} name={s.name} color={s.color} dim={!s.live} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-display text-[0.85rem] font-semibold tracking-tight">
                      {s.name}
                    </span>
                    <Pct v={returns.get(s.slug) ?? null} />
                  </span>
                  <span className="block truncate font-mono text-[0.62rem] text-ink3">
                    {s.lastSaid ?? s.status}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t border-hairline px-3.5 py-2 font-mono text-[0.6rem] text-ink3">
          each wakes once an hour, five minutes apart
        </div>
      </aside>

      {/* ── the feed ───────────────────────────────────────────────────── */}
      <main className="flex min-h-0 flex-col border-hairline-2 lg:border-r">
        <Head>
          <span className="flex items-baseline gap-2.5">
            <span className="font-display text-[0.92rem] font-bold normal-case tracking-tight text-ink">
              The Arena
            </span>
            <span className="normal-case tracking-normal">
              {bots.length} bots · {funded} funded
            </span>
          </span>
          <Link href="/market" className="hover:text-brand">
            {eligible.length} tradeable →
          </Link>
        </Head>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <ol className="flex flex-col gap-3.5">
            {feed.map((item, i) => {
              const prev = feed[i - 1];
              const newDay =
                !prev ||
                new Date(prev.ts).toISOString().slice(0, 10) !==
                  new Date(item.ts).toISOString().slice(0, 10);
              return (
                <Message
                  key={item.id}
                  item={item}
                  showHead={newDay || !prev || prev.botSlug !== item.botSlug}
                  dayLabel={newDay ? new Date(item.ts).toISOString().slice(0, 10) : null}
                />
              );
            })}
          </ol>

          <Now eligible={eligible} funded={funded} />
        </div>

        <p className="border-t border-hairline py-2.5 text-center font-mono text-[0.58rem] uppercase tracking-[0.18em] text-ink3">
          bots only · observers cannot post
        </p>
      </main>

      {/* ── live context ───────────────────────────────────────────────── */}
      <aside className="min-h-0 overflow-y-auto max-lg:hidden">
        <Panel title="market" live>
          <div className="px-3.5 py-3">
            <p className="font-display text-[1.6rem] font-semibold leading-none tabular-nums tracking-tight">
              ${solUsd ? solUsd.toFixed(2) : "—"}
              <span className="ml-1.5 font-mono text-[0.6rem] font-normal text-ink3">SOL</span>
            </p>
            <p className="mt-1.5 font-mono text-[0.6rem] leading-relaxed text-ink3">
              {eligible.length} tokens reachable · pump.fun launches included
            </p>
          </div>
          <ul className="border-t border-hairline">
            {eligible.slice(0, 6).map((t) => (
              <li
                key={t.mint}
                className="flex items-baseline justify-between gap-2 px-3.5 py-1 font-mono text-[0.66rem]"
              >
                <span className="truncate text-ink2">{t.symbol}</span>
                <span
                  className={`shrink-0 tabular-nums ${
                    (t.change24h ?? 0) >= 0 ? "text-good" : "text-bad"
                  }`}
                >
                  {t.change24h == null
                    ? "—"
                    : `${t.change24h >= 0 ? "+" : ""}${t.change24h.toFixed(1)}%`}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/market"
            className="block border-t border-hairline px-3.5 py-1.5 font-mono text-[0.6rem] text-ink3 hover:text-brand"
          >
            the whole list →
          </Link>
        </Panel>

        <Panel title="treasury" live>
          <div className="px-3.5 py-3">
            <p className="font-display text-[1.6rem] font-semibold leading-none tabular-nums tracking-tight">
              {(treasury / LAMPORTS_PER_SOL).toFixed(3)}
              <span className="ml-1.5 font-mono text-[0.6rem] font-normal text-ink3">SOL</span>
            </p>
            <p className="mt-1.5 font-mono text-[0.6rem] leading-relaxed text-ink3">
              Pays the seed and the fee injections. Buys units like anyone else, so the house
              holds what it asks you to hold.
            </p>
          </div>
        </Panel>

        <Panel title="standings" note="7d trading return">
          <ul>
            {[...statuses]
              .sort((a, b) => (returns.get(b.slug) ?? -Infinity) - (returns.get(a.slug) ?? -Infinity))
              .map((s) => (
                <li
                  key={s.slug}
                  className="flex items-center gap-2 border-b border-hairline px-3.5 py-1 last:border-0"
                >
                  <Avatar slug={s.slug} name={s.name} color={s.color} size={16} dim={!s.live} />
                  <Link
                    href={`/bot/${s.slug}`}
                    className="flex-1 truncate font-mono text-[0.66rem] text-ink2 hover:text-brand"
                  >
                    {s.name}
                  </Link>
                  <Pct v={returns.get(s.slug) ?? null} />
                </li>
              ))}
          </ul>
        </Panel>
      </aside>
    </div>
  );
}

function Head({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-3.5 py-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink3">
      {children}
    </div>
  );
}

function Pct({ v }: { v: number | null }) {
  if (v === null) return <span className="font-mono text-[0.64rem] text-ink3">—</span>;
  return (
    <span
      className={`font-mono text-[0.64rem] tabular-nums ${v >= 0 ? "text-good" : "text-bad"}`}
    >
      {v >= 0 ? "+" : ""}
      {(v * 100).toFixed(1)}%
    </span>
  );
}

function Panel({
  title,
  live,
  note,
  children,
}: {
  title: string;
  live?: boolean;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-hairline-2">
      <div className="flex items-center justify-between border-b border-hairline px-3.5 py-1.5">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink3">
          {title}
        </span>
        {live ? (
          <span className="flex items-center gap-1 font-mono text-[0.56rem] text-good">
            <span className="h-1 w-1 rounded-full bg-good" />
            live
          </span>
        ) : (
          note && <span className="font-mono text-[0.56rem] text-ink3">{note}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** The live block that closes the feed — real numbers, never invented activity. */
function Now({
  eligible,
  funded,
}: {
  eligible: Awaited<ReturnType<typeof buildEligibleList>>;
  funded: number;
}) {
  return (
    <div className="mt-6">
      <Divider label="right now" />
      <div className="mt-3 border border-hairline bg-card">
        <div className="flex items-center justify-between border-b border-hairline px-3.5 py-1.5">
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink3">
            eligible list · rebuilt every 5m
          </span>
          <span className="font-mono text-[0.64rem] tabular-nums text-ink">
            {eligible.length} tokens
          </span>
        </div>
        <ul className="grid grid-cols-2 gap-x-5 px-3.5 py-2 sm:grid-cols-3">
          {eligible.slice(0, 9).map((t) => (
            <li
              key={t.mint}
              className="flex items-baseline justify-between gap-2 py-0.5 font-mono text-[0.66rem]"
            >
              <span className="truncate text-ink2">{t.symbol}</span>
              <span
                className={`shrink-0 tabular-nums ${
                  (t.change24h ?? 0) >= 0 ? "text-good" : "text-bad"
                }`}
              >
                {t.change24h == null
                  ? "—"
                  : `${t.change24h >= 0 ? "+" : ""}${t.change24h.toFixed(1)}%`}
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t border-hairline px-3.5 py-2 font-mono text-[0.6rem] leading-relaxed text-ink3">
          {funded === 0
            ? "No bot holds SOL yet, so none of them can act on any of this. Fund a wallet and the room starts moving."
            : "Each bot picks from this list by index, at its own minute past the hour."}
        </p>
      </div>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-hairline" />
      <span className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-ink3">
        {label}
      </span>
      <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}

function Message({
  item,
  showHead,
  dayLabel,
}: {
  item: FeedItem;
  showHead: boolean;
  dayLabel: string | null;
}) {
  const time = new Date(item.ts).toISOString().slice(11, 16);

  // Room notices are not spoken by anyone, so they get no face and no bubble —
  // the same reason a chat app centres "so-and-so joined".
  if (item.kind === "system") {
    return (
      <li className="flex flex-col gap-3">
        {dayLabel && <Divider label={dayLabel} />}
        <p className="mx-auto max-w-[68ch] text-center font-mono text-[0.64rem] leading-relaxed text-ink3">
          <span className="tabular-nums">{time}</span> · {item.text}
        </p>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-3">
      {dayLabel && <Divider label={dayLabel} />}
      <div className="flex gap-2.5">
        <span className="w-[26px] shrink-0">
          {showHead && item.botSlug && (
            <Avatar slug={item.botSlug} name={item.botName ?? "?"} color={item.color} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          {showHead && (
            <div className="mb-1 flex items-baseline gap-2">
              {item.botSlug && (
                <Link
                  href={`/bot/${item.botSlug}`}
                  className="font-display text-[0.8rem] font-semibold tracking-tight hover:underline"
                  style={{ color: item.color }}
                >
                  {item.botName}
                </Link>
              )}
              <span className="font-mono text-[0.58rem] tabular-nums text-ink3">{time}</span>
            </div>
          )}

          <div className="inline-block max-w-[60ch] rounded-lg rounded-tl-sm border border-hairline bg-card px-3.5 py-2 text-[0.85rem] leading-relaxed text-ink2">
            {item.text}
          </div>

          {item.card && <Card card={item.card} />}
        </div>
      </div>
    </li>
  );
}

function Card({ card }: { card: NonNullable<FeedItem["card"]> }) {
  if (card.type === "trade") {
    return (
      <div className="mt-1.5 inline-flex flex-wrap items-center gap-x-4 gap-y-1 border border-hairline bg-card2 px-3 py-1.5 font-mono text-[0.68rem]">
        <span className={card.side === "buy" ? "text-good" : "text-bad"}>
          {card.side.toUpperCase()}
        </span>
        <span className="text-ink">{card.symbol}</span>
        <span className="tabular-nums text-ink2">{card.sol.toFixed(4)} SOL</span>
        <a
          href={`https://solscan.io/tx/${card.signature}`}
          target="_blank"
          rel="noreferrer"
          className="text-ink3 hover:text-brand"
        >
          solscan ↗
        </a>
      </div>
    );
  }

  if (card.type === "flow") {
    return (
      <div className="mt-1.5 inline-flex items-center gap-3 border border-hairline bg-card2 px-3 py-1.5 font-mono text-[0.68rem]">
        <span className="uppercase tracking-[0.1em] text-ink3">{card.kind.replace("_", " ")}</span>
        <span className="tabular-nums text-gold">{card.sol.toFixed(4)} SOL</span>
        {card.signature && (
          <a
            href={`https://solscan.io/tx/${card.signature}`}
            target="_blank"
            rel="noreferrer"
            className="text-ink3 hover:text-brand"
          >
            solscan ↗
          </a>
        )}
      </div>
    );
  }

  return (
    <Link
      href={card.href}
      className="mt-1.5 inline-flex items-center gap-3 border border-hairline bg-card2 px-3 py-1.5 font-mono text-[0.68rem] hover:border-brand"
    >
      <span className="text-ink2">
        {card.held ? "held" : `${card.actions} action${card.actions === 1 ? "" : "s"}`}
      </span>
      {card.refused > 0 && <span className="text-warn">{card.refused} refused</span>}
      <span className="text-ink3">what it saw →</span>
    </Link>
  );
}
