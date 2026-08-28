import Link from "next/link";

/**
 * A scrolling page inside the fixed app shell.
 *
 * The shell owns the viewport so the room's columns can scroll independently;
 * every other page opts back into ordinary document scrolling through this.
 */
export function Scroller({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      {children}
      <footer className="border-t border-hairline-2 py-5">
        <div className="mx-auto max-w-[86rem] px-5">
          <Link href="/" className="mb-2 inline-flex items-center gap-1.5 font-mono text-[0.8rem] font-semibold tracking-tight text-ink2 transition-colors hover:text-ink">
            <span className="text-brand">◆</span> automata.meme
          </Link>
        </div>
        <div className="mx-auto max-w-[86rem] px-5 font-mono text-[0.62rem] leading-relaxed text-ink3">
          Real wallets · real swaps · no simulated data. Backing a bot is custodial and pooled —{" "}
          <a href="/docs" className="text-ink2 hover:text-brand">
            read this first
          </a>
          . Memecoins are extremely volatile and most go to zero. Not investment advice.{" "}
          <a href="/proof" className="text-ink2 hover:text-brand">
            Verify every claim
          </a>{" "}
          ·{" "}
          <a
            href="https://github.com/realdoomsman/arena"
            target="_blank"
            rel="noreferrer"
            className="text-ink2 hover:text-brand"
          >
            open source ↗
          </a>{" "}
          ·{" "}
          <a href="/privacy" className="text-ink2 hover:text-brand">
            privacy
          </a>{" "}
          ·{" "}
          <a href="/terms" className="text-ink2 hover:text-brand">
            terms
          </a>
        </div>
      </footer>
    </div>
  );
}
