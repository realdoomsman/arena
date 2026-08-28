import Link from "next/link";
import { getDb } from "@/lib/db";
import { listBots, getBotReturn, totalUnits } from "@/lib/bot-nav";
import { personaFor } from "@/lib/bot-persona";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import { minutesToNextWake } from "@/lib/bots";
import { sparkline } from "@/lib/bot-stats";
import { Avatar } from "@/components/Avatar";
import { Sparkline } from "@/components/Sparkline";

const DAY = 24 * 3600_000;

/**
 * The point of the whole product, as one table.
 *
 * Ranked by 7-day trading return — perf_index only, so deposits and fee
 * injections cannot buy a bot a better row. Monkey is visually pinned out as
 * the bar: beating the market is not the claim, beating the random picker is.
 * Bots with no history sort to the bottom rather than being hidden, because
 * "has not traded" is true information.
 */
export function Leaderboard() {
  const db = getDb();
  const bots = listBots();

  // eslint-disable-next-line react-hooks/purity
  const nowMinute = new Date().getUTCMinutes();
  const rows = bots.map((b) => {
    const persona = personaFor(b.slug);
    const positions = (
      db.prepare("SELECT COUNT(*) AS n FROM bot_holdings WHERE bot_id = ? AND qty > 0").get(b.id) as {
        n: number;
      }
    ).n;
    return {
      slug: b.slug,
      name: b.name,
      kind: b.kind,
      color: persona.color,
      d7: getBotReturn(b.id, 7 * DAY),
      d24h: getBotReturn(b.id, DAY),
      d30: getBotReturn(b.id, 30 * DAY),
      spark: sparkline(b.id),
      backingSol: totalUnits(b.id) / LAMPORTS_PER_SOL,
      positions,
      nextWakeMin: minutesToNextWake(b.slot, nowMinute),
    };
  });

  // Ranked bots first (7d desc), then the unranked in roster order.
  const ranked = rows.filter((r) => r.d7 !== null).sort((a, b) => b.d7! - a.d7!);
  const unranked = rows.filter((r) => r.d7 === null);
  const ordered = [...ranked, ...unranked];
  const monkey = rows.find((r) => r.slug === "monkey");

  const pct = (v: number | null, strong = false) =>
    v === null ? (
      <span className="text-ink4">—</span>
    ) : (
      <span className={`num ${strong ? "font-semibold" : ""} ${v >= 0 ? "text-good" : "text-bad"}`}>
        {v >= 0 ? "+" : ""}
        {(v * 100).toFixed(1)}%
      </span>
    );

  return (
    <div className="card card-glass card-elevated overflow-hidden">
      <div className="flex items-center justify-between border-b border-hairline bg-card/50 px-5 py-4 backdrop-blur-sm">
        <h2 className="display-sm">Leaderboard</h2>
        <p className="th hidden sm:block">7-day trading return · beating Monkey is the bar</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-hairline">
              {["#", "Bot", "24h", "7d", "30d", "7d curve", "Backing", "Pos", "Wakes"].map((h, i) => (
                <th
                  key={h}
                  className={`px-4 py-3 ${i >= 2 ? "text-right" : "text-left"}`}
                >
                  <span className="th">{h}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {ordered.map((r, i) => {
              const isMonkey = r.slug === "monkey";
              const beatsMonkey =
                monkey?.d7 != null && r.d7 !== null && !isMonkey && r.d7 > monkey.d7;
              return (
                <tr
                  key={r.slug}
                  className={`table-row-hover ${isMonkey ? "bg-gold/5" : ""}`}
                >
                  <td className="px-4 py-3 num text-ink3">
                    {r.d7 === null ? "·" : i + 1}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/bot/${r.slug}`} className="group flex items-center gap-3">
                      <Avatar slug={r.slug} name={r.name} color={r.color} size={28} />
                      <span className="font-semibold text-ink group-hover:text-brand transition-colors">
                        {r.name}
                      </span>
                      {r.kind === "control" && (
                        <span className={`badge ${isMonkey ? "badge-warning" : ""}`}>
                          {isMonkey ? "the bar" : "control"}
                        </span>
                      )}
                      {beatsMonkey && <span className="badge badge-success">beats monkey</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">{pct(r.d24h)}</td>
                  <td className="px-4 py-3 text-right">{pct(r.d7, true)}</td>
                  <td className="px-4 py-3 text-right">{pct(r.d30)}</td>
                  <td className="px-4 py-3 text-right">
                    <Sparkline points={r.spark} />
                  </td>
                  <td className="px-4 py-3 text-right num text-ink2">
                    {r.backingSol > 0 ? `${r.backingSol.toFixed(2)} ◎` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right num text-ink2">
                    {r.positions > 0 ? r.positions : "—"}
                  </td>
                  <td className="px-4 py-3 text-right num text-ink3">
                    {r.nextWakeMin === 0 ? "now" : `${r.nextWakeMin}m`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ranked.length === 0 && (
        <p className="border-t border-hairline px-5 py-4 text-sm text-ink3">
          No bot has enough history to rank yet. The table fills in as soon as wallets are
          funded and the first week of snapshots exists — nothing here is ever simulated.
        </p>
      )}
    </div>
  );
}
