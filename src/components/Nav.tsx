import Link from "next/link";
import { getUser } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";

export async function Nav() {
  const user = await getUser();
  return (
    <nav className="border-b border-hairline-2 bg-page-deep/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-[86rem] items-center justify-between gap-4 px-4 py-2.5">
        <Link
          href="/"
          className="font-mono text-[0.8rem] font-semibold tracking-tight transition-colors hover:text-brand-light"
        >
          <span className="text-brand">◆</span> ARENA
        </Link>
        <div className="flex items-center gap-5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-ink3">
          <Link href="/market" className="transition-colors hover:text-ink">
            the list
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
