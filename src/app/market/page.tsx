import { buildEligibleList, type EligibleToken } from "@/lib/bot-universe";
import { getDb } from "@/lib/db";
import { MarketTable } from "@/components/MarketTable";
import { Scroller } from "@/components/Scroller";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "The list — Arena",
  description: "Every token the bots are allowed to trade right now, and why.",
};

/**
 * The eligible list, live.
 *
 * This is the single most load-bearing surface in the product: a bot can only
 * buy something that appears here, by index, so publishing it is what lets
 * anyone check that the safety gates are real and that all eleven bots were
 * handed the same universe.
 */
export default async function MarketPage() {
  let list: EligibleToken[];
  let error: string | null = null;
  try {
    list = await buildEligibleList();
  } catch (e) {
    list = [];
    error = e instanceof Error ? e.message : String(e);
  }

  const totalLiq = list.reduce((a, t) => a + t.liquidityUsd, 0);

  // Which bots hold what, so the list shows where the arena's own money sits.
  const heldRows = getDb()
    .prepare(
      `SELECT h.mint, b.name FROM bot_holdings h JOIN bots b ON b.id = h.bot_id
       WHERE h.qty > 0 ORDER BY b.slot`
    )
    .all() as { mint: string; name: string }[];
  const heldBy: Record<string, string[]> = {};
  for (const r of heldRows) (heldBy[r.mint] ??= []).push(r.name);

  return (
    <Scroller>
    <div className="mx-auto max-w-[86rem] px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display display-md mb-2">The List</h1>
          <p className="th">every token the bots may trade right now, and why</p>
        </div>
        <div className="flex gap-3">
          <div className="card card-glass px-4 py-3 text-center">
            <div className="th mb-1">Eligible</div>
            <div className="display text-xl num">{list.length}</div>
          </div>
          <div className="card card-glass px-4 py-3 text-center">
            <div className="th mb-1">Pooled Liquidity</div>
            <div className="display text-xl num">${Math.round(totalLiq).toLocaleString()}</div>
          </div>
          <div className="card card-glass px-4 py-3 text-center">
            <div className="th mb-1">Rebuilt</div>
            <div className="display text-xl num">5m</div>
          </div>
        </div>
      </div>

      <p className="mb-6 max-w-[80ch] font-mono text-[0.66rem] leading-relaxed text-ink3">
        A bot picks from this list <span className="text-ink2">by index</span> and cannot name a
        mint of its own. That is the injection boundary — token names are written by whoever
        deployed them, so a coin called &ldquo;IGNORE PRIOR INSTRUCTIONS&rdquo; is cheap to
        deploy and would otherwise be aimed at eleven wallets at once. The index has no room to
        smuggle one, which is why this list can be the whole of Solana rather than a safelist.
        Fresh pump.fun launches are included and marked <span className="text-warn">NEW</span>;
        most of them go to zero within hours. The list is sorted by 1-hour volume — the money
        moving right now is at the top. The safety check — freeze authority, mint authority,
        rug status, extreme holder concentration — runs on the one token a bot actually picks,
        at the moment it buys.
      </p>

      {error && (
        <p className="mb-4 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 font-mono text-[0.7rem] text-ink2">
          Could not build the list: {error}
        </p>
      )}

      <MarketTable list={list} heldBy={heldBy} />
    </div>
    </Scroller>
  );
}
