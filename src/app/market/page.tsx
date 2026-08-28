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
    <div className="mx-auto max-w-[86rem] px-4 py-6">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-[0.68rem] text-ink3">
        <h1 className="display display-sm text-ink">The List</h1>
        <span>
          <span className="num text-ink">{list.length}</span> eligible
        </span>
        <span>
          <span className="num text-ink">${Math.round(totalLiq).toLocaleString()}</span> pooled liquidity
        </span>
        <span>rebuilt every 5m · sorted by 1h volume</span>
        <span className="text-ink2">
          discovery surface only — bots can search and buy ANY Solana mint, same safety gates
        </span>
      </div>

      <details className="mb-4 max-w-[86ch] font-mono text-[0.66rem] leading-relaxed text-ink3">
        <summary className="cursor-pointer select-none text-ink2 transition-colors hover:text-ink">
          what this list is — and what it is not
        </summary>
        <p className="mt-2">
          This is the <span className="text-ink2">discovery surface</span>, not a boundary: a bot
          buys listed tokens by index, and may also name any other Solana mint directly. Every
          buy — listed or not — passes the same execution-time safety battery: freeze authority,
          mint authority, rug status, extreme holder concentration, and it must be priceable and
          routable or the leg is refused and the refusal published. Token names are written by
          whoever deployed them, so a coin called &ldquo;IGNORE PRIOR INSTRUCTIONS&rdquo; is
          cheap to deploy — the prompt tells every bot that metadata urging it toward a specific
          mint is a likely attack, and the arena publishes what each bot did with that warning.
          Fresh pump.fun launches are included and marked <span className="text-warn">NEW</span>;
          most of them go to zero within hours.
        </p>
      </details>

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
