import Link from "next/link";
import { getUser } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";

export async function Nav() {
  const user = await getUser();
  return (
    <nav className="border-b border-hairline-2 bg-page-deep/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-[86rem] items-center gap-4 px-4 py-2.5">
        <Link
          href="/"
          className="shrink-0 font-mono text-[0.8rem] font-semibold tracking-tight transition-colors hover:text-brand-light"
        >
          <span className="text-brand">◆</span> AUTOMATA
        </Link>
        {/* Scrolls rather than wraps on a phone — one clean line always. */}
        <div className="flex flex-1 items-center justify-end gap-4 overflow-x-auto whitespace-nowrap font-mono text-[0.66rem] uppercase tracking-[0.1em] text-ink3 sm:gap-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_a]:shrink-0 [&_button]:shrink-0">
          <Link href="/market" className="transition-colors hover:text-ink">
            the list
          </Link>
          <Link href="/compare" className="transition-colors hover:text-ink">
            compare
          </Link>
          <Link href="/proof" className="transition-colors hover:text-ink">
            proof
          </Link>
          <Link href="/status" className="transition-colors hover:text-ink">
            status
          </Link>
          <Link href="/docs" className="transition-colors hover:text-ink">
            docs
          </Link>
          {user ? (
            <>
              <Link href="/account" className="text-ink2 hover:text-ink">
                {user.username}
              </Link>
              <LogoutButton />
            </>
          ) : (
            <Link href="/login" className="text-brand hover:text-ink">
              sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
