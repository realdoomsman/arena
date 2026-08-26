"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Back a bot, or leave it.
 *
 * The withdraw result deliberately reports BOTH what the position was worth at
 * NAV and what it actually fetched. On a thin memecoin book those differ, and
 * the difference is the leaver's own slippage — hiding it would make every exit
 * look like a rounding error and every complaint look like a bug.
 */
export function BackBot({
  slug,
  botName,
  signedIn,
  myUnits,
}: {
  slug: string;
  botName: string;
  signedIn: boolean;
  myUnits: number;
}) {
  const router = useRouter();
  const [sol, setSol] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <div className="border border-hairline bg-card px-5 py-4 text-sm text-ink2">
        <a href="/login" className="text-brand">
          Sign in
        </a>{" "}
        to back {botName}.
      </div>
    );
  }

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/bots/${slug}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        error?: string;
        solPaid?: number;
        solAtNav?: number;
        units?: number;
      };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      if (path === "withdraw" && data.solPaid !== undefined) {
        const slip =
          data.solAtNav && data.solAtNav > 0
            ? ((1 - data.solPaid / data.solAtNav) * 100).toFixed(2)
            : null;
        setDone(
          `Paid ${data.solPaid.toFixed(4)} SOL` +
            (slip && Number(slip) > 0.01
              ? ` — ${slip}% under the ${data.solAtNav!.toFixed(4)} SOL mid-price value, which is the slippage on your own slice.`
              : ".")
        );
      } else {
        setDone(`Backed ${botName}.`);
      }
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-hairline bg-card px-5 py-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink3">
            Amount (SOL)
          </span>
          <input
            type="number"
            min="0.02"
            step="0.01"
            value={sol}
            onChange={(e) => setSol(e.target.value)}
            className="w-32 border border-hairline-2 bg-card2 px-3 py-2 font-mono text-sm tabular-nums outline-none focus:border-brand"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => post("invest", { sol: Number(sol) })}
          className="bg-brand px-4 py-2 font-display text-sm font-semibold tracking-tight text-page hover:bg-brand-dim disabled:opacity-50"
        >
          {busy ? "Working…" : `Back ${botName}`}
        </button>

        {myUnits > 0 && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => post("withdraw", { fraction: 0.5 })}
              className="border border-hairline-2 px-3 py-2 font-mono text-xs text-ink2 hover:border-brand hover:text-ink disabled:opacity-50"
            >
              take out half
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => post("withdraw", { fraction: 1 })}
              className="border border-hairline-2 px-3 py-2 font-mono text-xs text-ink2 hover:border-brand hover:text-ink disabled:opacity-50"
            >
              exit fully
            </button>
          </>
        )}
      </div>

      {error && <p className="mt-3 border-l-2 border-bad pl-3 text-sm text-ink2">{error}</p>}
      {done && <p className="mt-3 border-l-2 border-good pl-3 text-sm text-ink2">{done}</p>}

      <p className="mt-3 max-w-[62ch] text-xs leading-relaxed text-ink3">
        Your SOL joins {botName}&apos;s wallet and you receive pro-rata units. Leaving sells
        your slice of every position and pays you what it actually fetched — not the mid-price
        value, because paying that would take the difference from whoever stayed.
      </p>
    </div>
  );
}
