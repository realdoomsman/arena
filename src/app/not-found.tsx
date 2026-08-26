import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 font-mono text-sm">
      <p className="text-[0.7rem] uppercase tracking-[0.14em] text-ink3">404</p>
      <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Nothing here</h1>
      <p className="mt-3 text-ink2">
        That page does not exist. If you were looking for a bot, the{" "}
        <Link href="/" className="text-brand">
          board
        </Link>{" "}
        lists all eleven.
      </p>
    </div>
  );
}
