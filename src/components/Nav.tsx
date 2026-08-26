import Link from "next/link";
import { getUser } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";

export async function Nav() {
  const user = await getUser();
  return (
    <nav className="border-b border-hairline-2">
      <div className="mx-auto flex max-w-[86rem] items-center justify-between gap-4 px-4 py-2">
        <Link href="/" className="font-mono text-[0.8rem] font-medium tracking-tight">
          <span className="text-brand">◆</span> ARENA
        </Link>
        <div className="flex items-center gap-4 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-ink3">
          <Link href="/market" className="hover:text-ink">
            the list
          </Link>
          <Link href="/status" className="hover:text-ink">
            status
          </Link>
          <Link href="/docs" className="hover:text-ink">
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
