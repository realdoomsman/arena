import { Scroller } from "@/components/Scroller";

export const metadata = {
  title: "Privacy — Arena",
  description: "What Arena stores, what it never collects, and what is public by design.",
};

/**
 * The privacy page a data-minimal product can actually write: short, literal,
 * and checkable against the open-source schema it describes.
 */
export default function PrivacyPage() {
  return (
    <Scroller>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="display text-2xl">Privacy</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink2">
          Arena stores as little about you as a custodial product can. Every claim below is
          checkable against the{" "}
          <a
            href="https://github.com/realdoomsman/arena"
            target="_blank"
            rel="noreferrer"
            className="text-brand transition-colors hover:brightness-110"
          >
            open-source schema ↗
          </a>
          .
        </p>

        <section className="mt-8">
          <div className="section-label mb-3"><span>What we store</span></div>
          <ul className="card list-disc space-y-2 p-5 pl-10 text-[13px] leading-relaxed text-ink2">
            <li>Your email address and a username — to identify your account.</li>
            <li>
              If you sign up with a password: an scrypt hash of it. If you sign in with Google:
              no password exists at all, and Google only tells us your verified email.
            </li>
            <li>Session tokens, stored hashed — a leaked database cannot impersonate you.</li>
            <li>
              Your custodial wallet's key, encrypted with AES-256-GCM — this is the point of the
              product and the biggest thing you are trusting.
            </li>
            <li>
              Your deposits, withdrawals, backings and backer notes — notes are public by
              design, shown with your username.
            </li>
          </ul>
        </section>

        <section className="mt-8">
          <div className="section-label mb-3"><span>What we never collect</span></div>
          <ul className="card list-disc space-y-2 p-5 pl-10 text-[13px] leading-relaxed text-ink2">
            <li>No analytics, no trackers, no advertising pixels, no fingerprinting.</li>
            <li>No selling or sharing of your data with anyone.</li>
            <li>One cookie exists: your session. That is the whole list.</li>
          </ul>
        </section>

        <section className="mt-8 pb-12">
          <div className="section-label mb-3"><span>What is public by nature</span></div>
          <p className="card p-5 text-[13px] leading-relaxed text-ink2">
            Wallet addresses and every transaction they make are public on the Solana
            blockchain — that is what makes Arena verifiable, and it cannot be undone. Your
            email is never linked publicly to your wallet by us. To close your account,
            withdraw your funds and email{" "}
            <span className="text-ink">realdoomsalt@gmail.com</span> from your account address —
            we delete the row; the chain keeps what the chain keeps.
          </p>
        </section>
      </div>
    </Scroller>
  );
}
