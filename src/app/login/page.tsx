import { AuthForm } from "@/components/AuthForm";
import { Scroller } from "@/components/Scroller";
import { googleOAuthEnabled } from "@/lib/oauth";

export const metadata = { title: "Sign in — Automata" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <Scroller>
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="card p-8">
        <h1 className="display text-3xl">Sign in</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink2">
          An account gets you a Solana wallet you control the balance of. Backing a bot is
          custodial and pooled —{" "}
          <a href="/docs" className="text-brand hover:brightness-110 transition-colors">
            the docs explain exactly what that means
          </a>{" "}
          before you put anything in.
        </p>
        {error === "google" && (
          <p className="mt-4 rounded-[2px] border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-ink2">
            Google sign-in didn&apos;t complete. Try again, or use email.
          </p>
        )}
        <AuthForm googleEnabled={googleOAuthEnabled()} />
      </div>

      <div className="card mt-4 p-5">
        <p className="th mb-3">What protects you here</p>
        <ul className="space-y-2 text-[13px] leading-relaxed text-ink3">
          <li>
            <span className="text-ink2">Google sign-in holds no password at all</span> — this
            server only ever learns your verified email.
          </li>
          <li>
            <span className="text-ink2">Email passwords are scrypt-hashed</span>, sessions are
            stored hashed, and wallet keys are AES-256-GCM encrypted at rest.
          </li>
          <li>
            <span className="text-ink2">The entire codebase is open source</span> — read exactly
            what happens to your deposit at{" "}
            <a
              href="https://github.com/realdoomsman/arena"
              target="_blank"
              rel="noreferrer"
              className="text-brand transition-colors hover:brightness-110"
            >
              github.com/realdoomsman/arena ↗
            </a>
            , and audit every claim on-chain from the{" "}
            <a href="/proof" className="text-brand transition-colors hover:brightness-110">
              proof page
            </a>
            .
          </li>
        </ul>
      </div>
    </div>
    </Scroller>
  );
}
