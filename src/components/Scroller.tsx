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
      <footer className="border-t border-hairline-2 py-4">
        <div className="mx-auto max-w-[86rem] px-5 font-mono text-[0.62rem] leading-relaxed text-ink3">
          Real wallets · real swaps · no simulated data. Backing a bot is custodial and pooled —{" "}
          <a href="/docs" className="text-ink2 hover:text-brand">
            read this first
          </a>
          . Memecoins are extremely volatile and most go to zero. Not investment advice.
        </div>
      </footer>
    </div>
  );
}
