import { AuthForm } from "@/components/AuthForm";
import { Scroller } from "@/components/Scroller";

export const metadata = { title: "Sign in — Arena" };

export default function LoginPage() {
  return (
    <Scroller>
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink2">
        An account gets you a Solana wallet you control the balance of. Backing a bot is
        custodial and pooled —{" "}
        <a href="/docs" className="text-brand">
          the docs explain exactly what that means
        </a>{" "}
        before you put anything in.
      </p>
      <AuthForm />
    </div>
    </Scroller>
  );
}
