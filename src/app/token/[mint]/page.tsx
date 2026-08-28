import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { buildEligibleList } from "@/lib/bot-universe";
import { personaFor } from "@/lib/bot-persona";
import { isValidAddress } from "@/lib/custody";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import { tokenSafety } from "@/lib/bot-universe";
import { Avatar } from "@/components/Avatar";
import { PriceChart } from "@/components/PriceChart";
import { SafetyBadges } from "@/components/SafetyBadges";
import { Scroller } from "@/components/Scroller";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const row = getDb().prepare("SELECT symbol FROM token_meta WHERE mint = ?").get(mint) as
    | { symbol: string }
    | undefined;
  // The eligible list is module-cached for 5 minutes, so this is free.
  const live = (await buildEligibleList().catch(() => [])).find((t) => t.mint === mint);
  const name = live?.symbol ?? row?.symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  return {
    title: `${name} — Arena`,
    description: `Every bot position, fill and decision Arena has on ${name}, with on-chain receipts.`,
  };
}

/**
 * One token, cross-referenced: its live market row, which bots are in the
 * name, and every fill the arena has ever made in it — each linking back to
 * the decision that caused it. "Three models bought this within the hour,
 * here is each one's reasoning" is the whole product in one page.
 */
export default async function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  if (!isValidAddress(mint)) notFound();

  const db = getDb();
  const meta = db
    .prepare("SELECT symbol, name, decimals FROM token_meta WHERE mint = ?")
    .get(mint) as { symbol: string; name: string; decimals: number } | undefined;

  const list = await buildEligibleList().catch(() => []);
  const row = list.find((t) => t.mint === mint);

  const holders = db
    .prepare(
      `SELECT h.qty, h.cost_lamports, h.opened_at, b.slug, b.name FROM bot_holdings h
       JOIN bots b ON b.id = h.bot_id WHERE h.mint = ? AND h.qty > 0 ORDER BY b.slot`
    )
    .all(mint) as { qty: number; cost_lamports: number; opened_at: number; slug: string; name: string }[];

  const fills = db
    .prepare(
      `SELECT t.ts, t.side, t.lamports, t.qty, t.signature, t.decision_id, b.slug, b.name
       FROM bot_trades t JOIN bots b ON b.id = t.bot_id
       WHERE t.mint = ? ORDER BY t.ts DESC LIMIT 100`
    )
    .all(mint) as {
    ts: number;
    side: string;
    lamports: number;
    qty: number;
    signature: string;
    decision_id: number | null;
    slug: string;
    name: string;
  }[];

  const symbol = row?.symbol ?? meta?.symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  const fullName = row?.name ?? meta?.name ?? "";

  // A token nobody has traded and the feeds don't carry is a dead URL, not a page.
  if (!row && !meta && holders.length === 0 && fills.length === 0) notFound();

  // The RugCheck safety facts (cached 6h with the buy-time gate — a page view
  // rarely spends a fresh call). Only worth showing for a token on the list;
  // an arbitrary dead mint would just burn a call for em-dashes.
  const safety = row ? await tokenSafety(mint).catch(() => null) : null;

  const pct = (v: number | null) =>
    v == null ? (
      <span className="text-ink4">—</span>
    ) : (
      <span className={`num ${v >= 0 ? "text-good" : "text-bad"}`}>
        {v >= 0 ? "+" : ""}
        {v.toFixed(1)}%
      </span>
    );

  return (
    <Scroller>
      <div className="mx-auto max-w-[86rem] px-4 py-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="display display-md">{symbol}</h1>
          {fullName && fullName !== symbol && <span className="text-ink3">{fullName}</span>}
          {row?.fresh && <span className="badge badge-warning">NEW</span>}
          {row?.launchpad && <span className="badge">{row.launchpad}</span>}
          <a
            href={`https://solscan.io/token/${mint}`}
            target="_blank"
            rel="noreferrer"
            className="th transition-colors hover:text-brand"
          >
            solscan ↗
          </a>
        </div>
        <p className="num mt-1 break-all text-[0.68rem] text-ink4">{mint}</p>

        {row ? (
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[44rem] font-mono text-[13px]">
              <thead>
                <tr className="border-b border-hairline bg-card2">
                  {["price", "5m", "1h", "24h", "vol 1h", "liquidity", "mcap", "holders", "age"].map((h) => (
                    <th key={h} className="px-3 py-2 text-right first:text-left">
                      <span className="th">{h}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-3 py-2 num text-ink">${row.priceUsd.toPrecision(4)}</td>
                  <td className="px-3 py-2 text-right">{pct(row.change5m)}</td>
                  <td className="px-3 py-2 text-right">{pct(row.change1h)}</td>
                  <td className="px-3 py-2 text-right">{pct(row.change24h)}</td>
                  <td className="px-3 py-2 text-right num text-ink2">
                    {row.vol1hUsd == null ? "—" : `$${Math.round(row.vol1hUsd).toLocaleString()}`}
                  </td>
                  <td className="px-3 py-2 text-right num text-ink2">
                    ${Math.round(row.liquidityUsd).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right num text-ink3">
                    {row.mcapUsd ? `$${Math.round(row.mcapUsd).toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right num text-ink3">
                    {row.holders?.toLocaleString() ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right num text-ink3">
                    {row.ageHours == null
                      ? "—"
                      : row.ageHours < 48
                        ? `${row.ageHours.toFixed(1)}h`
                        : `${Math.round(row.ageHours / 24)}d`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-[13px] text-ink3">
            Not on the current discovery list — a bot can still buy it by naming the mint
            directly, or find it with its search tool.
          </p>
        )}

        {safety && <SafetyBadges safety={safety} />}

        {/* key={mint} remounts on client navigation between tokens, so the
            chart never shows the previous token's line under the new one. */}
        <PriceChart key={mint} mint={mint} />

        <section className="mt-8">
          <div className="section-label mb-3">
            <span>Bots in this name</span>
          </div>
          {holders.length === 0 ? (
            <p className="text-[13px] text-ink3">No bot currently holds it.</p>
          ) : (
            <ul className="card divide-y divide-hairline">
              {holders.map((h) => (
                <li key={h.slug}>
                  <Link
                    href={`/bot/${h.slug}`}
                    className="flex items-center gap-3 px-4 py-2.5 table-row-hover"
                  >
                    <Avatar slug={h.slug} name={h.name} color={personaFor(h.slug).color} size={24} />
                    <span className="text-[13px] font-semibold text-ink">{h.name}</span>
                    <span className="num ml-auto text-[13px] text-ink2">
                      {h.qty.toPrecision(6)} · cost {(h.cost_lamports / LAMPORTS_PER_SOL).toFixed(3)}◎
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8 pb-12">
          <div className="section-label mb-3">
            <span>Every arena fill</span>
            <span className="text-ink4 normal-case tracking-normal">
              each links to the decision behind it
            </span>
          </div>
          {fills.length === 0 ? (
            <p className="text-[13px] text-ink3">No bot has ever traded it.</p>
          ) : (
            <div className="card divide-y divide-hairline">
              {fills.map((f, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-2 table-row-hover">
                  <Link href={`/bot/${f.slug}`} className="flex items-center gap-2">
                    <Avatar slug={f.slug} name={f.name} color={personaFor(f.slug).color} size={20} />
                    <span className="text-[13px] font-semibold text-ink">{f.name}</span>
                  </Link>
                  <span className={`badge ${f.side === "buy" ? "badge-success" : "badge-danger"}`}>
                    {f.side}
                  </span>
                  <span className="num text-[13px] text-ink2">
                    {(f.lamports / LAMPORTS_PER_SOL).toFixed(3)}◎
                  </span>
                  <span className="th">{new Date(f.ts).toISOString().slice(0, 16).replace("T", " ")}</span>
                  <span className="ml-auto flex items-center gap-3">
                    {f.decision_id && (
                      <Link
                        href={`/bot/${f.slug}/decisions/${f.decision_id}`}
                        className="th transition-colors hover:text-brand"
                      >
                        why →
                      </Link>
                    )}
                    <a
                      href={`https://solscan.io/tx/${f.signature}`}
                      target="_blank"
                      rel="noreferrer"
                      className="th transition-colors hover:text-brand"
                    >
                      tx ↗
                    </a>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Scroller>
  );
}
