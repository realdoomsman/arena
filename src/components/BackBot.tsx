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
  solUsd = null,
}: {
  slug: string;
  botName: string;
  signedIn: boolean;
  myUnits: number;
  solUsd?: number | null;
}) {
  const router = useRouter();
  const [sol, setSol] = useState("0.1");
  const amountUsd = solUsd != null && Number(sol) > 0 ? Number(sol) * solUsd : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <div className="text-sm text-ink2">
        <a href="/login" className="text-brand transition-colors hover:text-brand-light">
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
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="th flex items-center gap-2">
            Amount (SOL)
            {amountUsd != null && (
              <span className="text-ink3">≈ ${amountUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
            )}
          </span>
          <input
            type="number"
            min="0.02"
            step="0.01"
            value={sol}
            onChange={(e) => setSol(e.target.value)}
            className="w-32 rounded-[2px] border border-hairline-2 bg-card2 px-3 py-2 font-mono text-sm tabular-nums outline-none transition-colors focus:border-brand"
          />
          <div className="mt-1 flex gap-1.5">
            {[0.1, 0.5, 1].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setSol(String(v))}
                className="badge cursor-pointer transition-colors hover:border-hairline-3 hover:text-ink"
              >
                {v}◎{solUsd != null ? ` · $${Math.round(v * solUsd)}` : ""}
              </button>
            ))}
          </div>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => post("invest", { sol: Number(sol) })}
          className="btn-primary px-5 py-2 font-display text-sm tracking-tight disabled:opacity-50"
        >
          {busy ? "Working…" : `Back ${botName}`}
        </button>

        {myUnits > 0 && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => post("withdraw", { fraction: 0.5 })}
              className="btn-secondary px-4 py-2 font-mono text-xs disabled:opacity-50"
            >
              take out half
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => post("withdraw", { fraction: 1 })}
              className="btn-secondary px-4 py-2 font-mono text-xs disabled:opacity-50"
            >
              exit fully
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-[2px] border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-ink2">{error}</p>
      )}
      {done && (
        <p className="mt-3 rounded-[2px] border border-good/30 bg-good/5 px-3 py-2 text-sm text-ink2">{done}</p>
      )}

      <p className="mt-3 max-w-[62ch] text-xs leading-relaxed text-ink3">
        Your SOL joins {botName}&apos;s wallet and you receive pro-rata units. Leaving sells
        your slice of every position and pays you what it actually fetched — not the mid-price
        value, because paying that would take the difference from whoever stayed.
      </p>
    </div>
  );
}
