"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Send SOL out of the account wallet. The exit door, always available. */
export function WithdrawSol({ balance }: { balance: number }) {
  const router = useRouter();
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: dest.trim(), sol: Number(amount) }),
      });
      const data = (await res.json()) as { error?: string; signature?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "Something went wrong" });
        return;
      }
      setMsg({ ok: true, text: `Sent. ${data.signature?.slice(0, 16)}…` });
      setAmount("");
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Could not reach the server" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2 border-t border-hairline pt-3">
      <label className="flex flex-1 flex-col gap-1">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink3">
          send to
        </span>
        <input
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          placeholder="Solana address"
          className="min-w-[16rem] border border-hairline-2 bg-card2 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-brand"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink3">sol</span>
        <input
          type="number"
          step="0.001"
          min="0"
          max={balance}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-28 border border-hairline-2 bg-card2 px-2.5 py-1.5 font-mono text-xs tabular-nums outline-none focus:border-brand"
        />
      </label>
      <button
        type="submit"
        disabled={busy || balance <= 0}
        className="border border-hairline-2 px-3 py-1.5 font-mono text-xs text-ink2 hover:border-brand hover:text-ink disabled:opacity-40"
      >
        {busy ? "sending…" : "withdraw"}
      </button>
      {msg && (
        <p
          className={`w-full font-mono text-[0.68rem] ${msg.ok ? "text-good" : "text-bad"}`}
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}
