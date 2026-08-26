import { buildEligibleList, type EligibleToken } from "@/lib/bot-universe";
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

  return (
    <Scroller>
    <div className="mx-auto max-w-[86rem] px-4 py-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-hairline-2 pb-2.5 font-mono text-[0.7rem] text-ink3">
        <span>
          <span className="uppercase tracking-[0.1em]">eligible</span>{" "}
          <span className="tabular-nums text-ink">{list.length}</span>
        </span>
        <span>
          <span className="uppercase tracking-[0.1em]">pooled liquidity</span>{" "}
          <span className="tabular-nums text-ink">${Math.round(totalLiq).toLocaleString()}</span>
        </span>
        <span>
          <span className="uppercase tracking-[0.1em]">rebuilt</span>{" "}
          <span className="tabular-nums text-ink">every 5m</span>
        </span>
      </div>

      <p className="mt-2.5 max-w-[80ch] font-mono text-[0.66rem] leading-relaxed text-ink3">
        A bot picks from this list <span className="text-ink2">by index</span> and cannot name a
        mint of its own. That is the injection boundary — token names are written by whoever
        deployed them, so a coin called &ldquo;IGNORE PRIOR INSTRUCTIONS&rdquo; is cheap to
        deploy and would otherwise be aimed at eleven wallets at once. The index has no room to
        smuggle one, which is why this list can be the whole of Solana rather than a safelist.
        Fresh pump.fun launches are included and marked <span className="text-warn">NEW</span>;
        most of them go to zero within hours. The safety check — freeze authority, mint
        authority, rug status, extreme holder concentration — runs on the one token a bot
        actually picks, at the moment it buys.
      </p>

      {error && (
        <p className="mt-3 border-l-2 border-bad bg-card px-3 py-2 font-mono text-[0.7rem] text-ink2">
          Could not build the list: {error}
        </p>
      )}

      <div className="mt-5 overflow-x-auto border border-hairline">
        <table className="w-full min-w-[58rem] border-collapse">
          <thead>
            <tr className="bg-card2">
              {["idx", "symbol", "name", "price", "1h", "24h", "liquidity", "mcap", "holders"].map(
                (h) => (
                  <th
                    key={h}
                    className={`px-3 py-1.5 font-mono text-[0.6rem] font-normal uppercase tracking-[0.1em] text-ink3 ${
                      ["price", "1h", "24h", "liquidity", "mcap", "holders"].includes(h)
                        ? "text-right"
                        : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.mint} className="border-t border-hairline bg-card hover:bg-card2">
                <td className="px-3 py-1.5 font-mono text-[0.68rem] tabular-nums text-ink3">
                  {t.idx}
                </td>
                <td className="px-3 py-1.5">
                  <a
                    href={`https://solscan.io/token/${t.mint}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[0.8rem] font-medium hover:text-brand"
                  >
                    {t.symbol}
                  </a>
                </td>
                <td className="max-w-[14rem] truncate px-3 py-1.5 font-mono text-[0.66rem] text-ink3">
                  {t.fresh && <span className="mr-1.5 text-warn">NEW</span>}
                  {t.name}
                  {t.launchpad && <span className="ml-1.5 text-ink3">· {t.launchpad}</span>}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[0.72rem] tabular-nums text-ink2">
                  ${t.priceUsd.toPrecision(4)}
                </td>
                <td
                  className={`px-3 py-1.5 text-right font-mono text-[0.72rem] tabular-nums ${
                    t.change1h == null ? "text-ink3" : t.change1h >= 0 ? "text-good" : "text-bad"
                  }`}
                >
                  {t.change1h == null ? "—" : `${t.change1h >= 0 ? "+" : ""}${t.change1h.toFixed(1)}%`}
                </td>
                <td
                  className={`px-3 py-1.5 text-right font-mono text-[0.72rem] tabular-nums ${
                    t.change24h == null ? "text-ink3" : t.change24h >= 0 ? "text-good" : "text-bad"
                  }`}
                >
                  {t.change24h == null
                    ? "—"
                    : `${t.change24h >= 0 ? "+" : ""}${t.change24h.toFixed(1)}%`}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[0.72rem] tabular-nums text-ink2">
                  ${Math.round(t.liquidityUsd).toLocaleString()}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[0.72rem] tabular-nums text-ink3">
                  {t.mcapUsd ? `$${Math.round(t.mcapUsd).toLocaleString()}` : "—"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[0.72rem] tabular-nums text-ink3">
                  {t.holders ? t.holders.toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </Scroller>
  );
}
