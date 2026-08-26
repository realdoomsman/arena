import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { getAccountWallet, getSolBalance, LAMPORTS_PER_SOL } from "@/lib/accounts";
import { myPositions } from "@/lib/bot-invest";
import { getBot, getBotNav } from "@/lib/bot-nav";
import { WithdrawSol } from "@/components/WithdrawSol";
import { Scroller } from "@/components/Scroller";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account — Arena" };

/**
 * Wallet and positions.
 *
 * Position values are computed from live NAV where it can be computed, and
 * shown as unknown where it cannot. A position in a bot holding an unpriceable
 * token genuinely has no knowable value right now, and rendering a stale number
 * would be worse than saying so.
 */
export default async function AccountPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const wallet = getAccountWallet(user.id);
  const sol = wallet ? await getSolBalance(wallet.address) : 0;
  const positions = myPositions(user.id);

  const valued = await Promise.all(
    positions.map(async (p) => {
      const bot = getBot(p.slug);
      const nav = bot ? await getBotNav(bot) : null;
      return {
        ...p,
        valueLamports: nav ? Math.floor(p.units * nav.navPerUnit) : null,
      };
    })
  );

  return (
    <Scroller>
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="font-display text-3xl font-bold tracking-tight">{user.username}</h1>

      <section className="mt-8">
        <h2 className="border-b border-hairline pb-2 font-display text-lg font-semibold tracking-tight">
          Your wallet
        </h2>
        <div className="border-x border-b border-hairline bg-card px-5 py-5">
          <p className="font-display text-3xl font-semibold tabular-nums tracking-tight">
            {sol.toFixed(4)} <span className="text-base text-ink3">SOL</span>
          </p>
          {wallet && (
            <a
              href={`https://solscan.io/account/${wallet.address}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block break-all font-mono text-[0.7rem] text-ink3 hover:text-brand"
            >
              {wallet.address}
            </a>
          )}
          <p className="mt-3 max-w-[60ch] text-xs leading-relaxed text-ink3">
            Deposit by sending SOL to this address. It is a custodial wallet: the platform
            holds the encrypted key, which is what lets a bot trade on your behalf without you
            signing every hour.
          </p>
          <WithdrawSol balance={sol} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="border-b border-hairline pb-2 font-display text-lg font-semibold tracking-tight">
          Bots you back
        </h2>
        {valued.length === 0 ? (
          <p className="border-x border-b border-hairline bg-card px-5 py-6 text-sm text-ink3">
            You are not backing any bot yet. Pick one from{" "}
            <Link href="/" className="text-brand">
              the board
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-hairline border-x border-b border-hairline">
            {valued.map((p) => (
              <li
                key={p.slug}
                className="flex flex-wrap items-baseline justify-between gap-3 bg-card px-5 py-4"
              >
                <div>
                  <Link href={`/bot/${p.slug}`} className="font-display font-semibold hover:text-brand">
                    {p.name}
                  </Link>
                  <p className="font-mono text-[0.65rem] text-ink3">
                    {p.sharePct.toFixed(2)}% of the book · cost{" "}
                    {(p.cost / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm tabular-nums">
                    {p.valueLamports === null
                      ? "value unknown"
                      : `${(p.valueLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`}
                  </p>
                  {p.valueLamports !== null && p.cost > 0 && (
                    <p
                      className={`font-mono text-[0.65rem] tabular-nums ${
                        p.valueLamports >= p.cost ? "text-good" : "text-bad"
                      }`}
                    >
                      {((p.valueLamports / p.cost - 1) * 100).toFixed(1)}%
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
    </Scroller>
  );
}
