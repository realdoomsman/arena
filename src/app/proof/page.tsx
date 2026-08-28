import Link from "next/link";
import { getDb } from "@/lib/db";
import { listBots, totalUnits, botLiabilityLamports, botAum } from "@/lib/bot-nav";
import { getTreasury } from "@/lib/treasury";
import { lastReconcile, crashedWakes } from "@/lib/bot-reconcile";
import { personaFor } from "@/lib/bot-persona";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import { Avatar } from "@/components/Avatar";
import { Scroller } from "@/components/Scroller";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Proof — Automata",
  description:
    "Every wallet, every fill, every claim — verifiable on-chain and in the open-source code. Don't trust; check.",
};

/**
 * The trust page, built on the only honest foundation a custodial product
 * has: making every claim independently checkable. No badges, no seals —
 * addresses, transactions, source code, and live reconciliation between the
 * database and the chain.
 */
export default function ProofPage() {
  const db = getDb();
  const bots = listBots();
  const treasury = getTreasury();
  const recon = lastReconcile();
  const crashed = crashedWakes();

  const liabilities = bots
    .map((b) => ({
      slug: b.slug,
      name: b.name,
      wallet: b.wallet,
      backers: botAum(b.id).holders,
      units: totalUnits(b.id),
      owedSol: botLiabilityLamports(b.id) / LAMPORTS_PER_SOL,
    }))
    .filter((r) => r.units > 0);
  const totalOwedSol = liabilities.reduce((a, r) => a + r.owedSol, 0);

  const decisions = (db.prepare("SELECT COUNT(*) AS n FROM bot_decisions").get() as { n: number }).n;
  const trades = (db.prepare("SELECT COUNT(*) AS n FROM bot_trades").get() as { n: number }).n;

  const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? null;
  const repo = "https://github.com/realdoomsman/arena";

  return (
    <Scroller>
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="display text-2xl">Proof</h1>
        <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-ink2">
          A site that custodies money should not ask to be trusted — it should hand over the
          means to check. Everything Automata claims is verifiable from three primary sources:
          the Solana chain, the open-source code, and this page&apos;s live reconciliation
          between the two.
        </p>

        <section className="mt-8">
          <div className="section-label mb-3"><span>The code that is running</span></div>
          <div className="card p-5 text-[13px] leading-relaxed text-ink2">
            <p>
              Automata is fully open source:{" "}
              <a href={repo} target="_blank" rel="noreferrer" className="text-brand transition-colors hover:brightness-110">
                {repo.replace("https://", "")} ↗
              </a>
            </p>
            <p className="mt-2">
              {sha ? (
                <>
                  This deployment is built from commit{" "}
                  <a
                    href={`${repo}/commit/${sha}`}
                    target="_blank"
                    rel="noreferrer"
                    className="num text-brand transition-colors hover:brightness-110"
                  >
                    {sha.slice(0, 12)} ↗
                  </a>{" "}
                  — the exact executor, safety gates, accounting and prompts you can read there
                  are the ones handling every wallet below.
                </>
              ) : (
                <>This is a local development build; production pages name the exact commit they run.</>
              )}
            </p>
            <p className="mt-2 text-ink3">
              The shared system prompt, every decision&apos;s full input snapshot, every model&apos;s
              reasoning and every executor refusal are published as they happen — {decisions}{" "}
              decisions and {trades} on-chain fills so far.
            </p>
          </div>
        </section>

        <section className="mt-8">
          <div className="section-label mb-3">
            <span>Every wallet, on-chain</span>
            <span className="text-ink3 normal-case tracking-normal">balances answer to Solana, not to this database</span>
          </div>
          <ul className="card divide-y divide-hairline">
            {treasury && (
              <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="w-24 shrink-0 text-[13px] font-semibold text-ink">Treasury</span>
                <a
                  href={`https://solscan.io/account/${treasury.wallet}`}
                  target="_blank"
                  rel="noreferrer"
                  className="num break-all text-[0.72rem] text-ink3 transition-colors hover:text-brand"
                >
                  {treasury.wallet} ↗
                </a>
              </li>
            )}
            {bots.map((b) => (
              <li key={b.slug} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <Link href={`/bot/${b.slug}`} className="flex w-24 shrink-0 items-center gap-2">
                  <Avatar slug={b.slug} name={b.name} color={personaFor(b.slug).color} size={20} />
                  <span className="text-[13px] font-semibold text-ink">{b.name}</span>
                </Link>
                <a
                  href={`https://solscan.io/account/${b.wallet}`}
                  target="_blank"
                  rel="noreferrer"
                  className="num break-all text-[0.72rem] text-ink3 transition-colors hover:text-brand"
                >
                  {b.wallet} ↗
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <div className="section-label mb-3">
            <span>Proof of liabilities</span>
            <span className="text-ink3 normal-case tracking-normal">
              what is owed to backers — compare to each wallet above
            </span>
          </div>
          {liabilities.length === 0 ? (
            <p className="card p-5 text-[13px] leading-relaxed text-ink3">
              No bot has outside backers yet, so nothing is owed. The house seed is the only
              capital in play. This table fills in as people back bots — and always footnotes
              the on-chain assets that must cover it.
            </p>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-[13px]">
                  <thead>
                    <tr className="border-b border-hairline bg-card2">
                      {["Bot", "Backers", "Units", "Owed (SOL)", "Assets"].map((h, i) => (
                        <th key={h} className={`px-4 py-2 ${i >= 1 ? "text-right" : "text-left"}`}>
                          <span className="th">{h}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {liabilities.map((r) => (
                      <tr key={r.slug} className="table-row-hover">
                        <td className="px-4 py-2.5">
                          <Link href={`/bot/${r.slug}`} className="flex items-center gap-2">
                            <Avatar slug={r.slug} name={r.name} color={personaFor(r.slug).color} size={20} />
                            <span className="font-semibold text-ink">{r.name}</span>
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-right num text-ink2">{r.backers}</td>
                        <td className="px-4 py-2.5 text-right num text-ink3">{Math.round(r.units).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right num text-ink">{r.owedSol.toFixed(3)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <a
                            href={`https://solscan.io/account/${r.wallet}`}
                            target="_blank"
                            rel="noreferrer"
                            className="th text-ink3 transition-colors hover:text-brand"
                          >
                            on-chain ↗
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-hairline">
                      <td className="px-4 py-2.5 th text-ink2">Total owed</td>
                      <td colSpan={2} />
                      <td className="px-4 py-2.5 text-right num font-semibold text-ink">
                        {totalOwedSol.toFixed(3)} ◎
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="border-t border-hairline px-4 py-3 text-[0.72rem] leading-relaxed text-ink3">
                Owed is each bot&apos;s outstanding units valued at its latest unit price. A bot is
                solvent when its wallet&apos;s on-chain balance (the Assets link) covers what it
                owes — check any row yourself against Solscan. Unit value moves with the bot&apos;s
                trading, so what you can withdraw rises and falls with performance; that is the
                deal, stated in the docs.
              </p>
            </div>
          )}
        </section>

        <section className="mt-8">
          <div className="section-label mb-3"><span>Ledger vs chain, right now</span></div>
          <div className="card p-5 text-[13px] leading-relaxed">
            <p className={recon && recon.divergences.length > 0 ? "text-bad" : "text-ink2"}>
              {recon === null
                ? "Not reconciled since boot — the check runs automatically at every restart."
                : recon.divergences.length === 0
                  ? `Clean. ${recon.checkedSignatures} on-chain signature(s) across ${recon.checkedBots} bot wallets match the published ledger${recon.unreachable.length ? ` (${recon.unreachable.length} wallet(s) unreachable this pass)` : ""}.`
                  : `${recon.divergences.length} on-chain transaction(s) missing from the ledger: ${recon.divergences.map((d) => d.botSlug).join(", ")} — shown here rather than hidden, until resolved.`}
            </p>
            <p className={`mt-2 ${crashed.length > 0 ? "text-warn" : "text-ink3"}`}>
              {crashed.length === 0
                ? "Every wake that started also finished — no half-recorded trades."
                : `${crashed.length} wake(s) started and did not finish cleanly; their wallets are checked against the chain.`}
            </p>
          </div>
        </section>

        <section className="mt-8 pb-12">
          <div className="section-label mb-3"><span>Verify it yourself</span></div>
          <ol className="card list-decimal space-y-2 p-5 pl-10 text-[13px] leading-relaxed text-ink2">
            <li>
              Pick any fill on any bot page and open its <span className="text-ink">tx ↗</span>{" "}
              link — the swap, its size and its wallet are on Solscan, signed by the address above.
            </li>
            <li>
              Open the decision behind that fill: the exact market snapshot the model was
              handed, its verbatim reasoning, every lookup it ran, and anything the executor
              refused.
            </li>
            <li>
              Read the{" "}
              <a href={`${repo}/blob/main/src/lib/bot-decision.ts`} target="_blank" rel="noreferrer" className="text-brand transition-colors hover:brightness-110">
                executor
              </a>{" "}
              and{" "}
              <a href={`${repo}/blob/main/src/lib/bot-invest.ts`} target="_blank" rel="noreferrer" className="text-brand transition-colors hover:brightness-110">
                unit accounting
              </a>{" "}
              — the code that decides what a bot may do and what your units are worth.
            </li>
            <li>
              Sum any bot&apos;s fills and flows yourself and compare against its wallet on
              Solscan. The books have nowhere to hide: the chain is the ledger of record.
            </li>
          </ol>
          <p className="mt-4 max-w-[70ch] text-[13px] leading-relaxed text-ink3">
            What cannot be verified from outside — and we say so plainly in{" "}
            <Link href="/docs" className="text-brand transition-colors hover:brightness-110">
              the docs
            </Link>{" "}
            — is custody itself: the platform holds the encrypted keys. That is the one thing
            you are actually trusting, and it is why the docs tell you to treat any deposit as
            money you can lose.
          </p>
        </section>
      </div>
    </Scroller>
  );
}
