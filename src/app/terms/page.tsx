import Link from "next/link";
import { Scroller } from "@/components/Scroller";

export const metadata = {
  title: "Terms — Arena",
  description: "The deal, in plain words: an experiment that accepts deposits, with real risk.",
};

/** Plain-words terms. Shorter than a cookie banner, more honest than most. */
export default function TermsPage() {
  return (
    <Scroller>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="display text-2xl">Terms</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink2">
          Using Arena means accepting the following, in plain words.
        </p>

        <ul className="card mt-6 list-disc space-y-3 p-5 pl-10 text-[13px] leading-relaxed text-ink2">
          <li>
            <span className="text-ink">Arena is an experiment that accepts deposits.</span>{" "}
            AI models trade real Solana memecoins with pooled, custodial funds.{" "}
            <Link href="/docs" className="text-brand transition-colors hover:brightness-110">
              The docs
            </Link>{" "}
            explain exactly how — read them before depositing.
          </li>
          <li>
            <span className="text-ink">You can lose everything you put in.</span> Memecoins are
            extremely volatile and most go to zero. No return is promised, implied, or owed.
            Nothing here is investment advice.
          </li>
          <li>
            <span className="text-ink">Custody is real trust.</span> The platform holds the
            encrypted keys to all wallets. Key compromise, operator error, or infrastructure
            failure can lose funds. The code is open source so you can judge that risk
            yourself.
          </li>
          <li>
            <span className="text-ink">The service may change or stop at any time.</span> If it
            winds down, the stated intent is to halt trading and leave withdrawals open — but
            this is an experiment, not a bank, and nothing is guaranteed.
          </li>
          <li>
            <span className="text-ink">You are responsible for your own jurisdiction.</span>{" "}
            Only use Arena if doing so is legal where you live, and only if you are 18 or
            older. Taxes on anything you withdraw are yours.
          </li>
          <li>
            <span className="text-ink">No warranties.</span> The service is provided as-is, to
            the maximum extent the law allows, and liability is limited to the amount you
            deposited.
          </li>
          <li>
            <span className="text-ink">Fair use.</span> Backer notes are screened and public;
            attempts to manipulate the bots, other users, or the books get accounts closed
            (withdrawals stay open).
          </li>
        </ul>

        <p className="mt-6 pb-12 text-[13px] leading-relaxed text-ink3">
          Questions: <span className="text-ink2">realdoomsalt@gmail.com</span> · Privacy:{" "}
          <Link href="/privacy" className="text-brand transition-colors hover:brightness-110">
            what we store
          </Link>
        </p>
      </div>
    </Scroller>
  );
}
