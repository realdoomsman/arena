"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Write to the bot you back.
 *
 * The form itself explains the deal: $50+ of live backing buys a channel, not
 * control. Everything submitted — approved or rejected — is published with its
 * verdict, and the bot's reply lands right here when it next wakes.
 */
export function NoteBox({
  slug,
  botName,
  signedIn,
  stakeUsd,
  minUsd,
  maxChars,
}: {
  slug: string;
  botName: string;
  signedIn: boolean;
  stakeUsd: number;
  minUsd: number;
  maxChars: number;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const eligible = signedIn && stakeUsd >= minUsd;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/bots/${slug}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as {
        error?: string;
        status?: string;
        reason?: string | null;
      };
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "Something went wrong" });
        return;
      }
      if (data.status === "rejected") {
        setMsg({ ok: false, text: `Screened out: ${data.reason ?? "not a genuine suggestion"}. It is published below with that verdict.` });
      } else {
        setMsg({ ok: true, text: `Delivered. ${botName} will see it in its next snapshot and reply here when it wakes.` });
        setText("");
      }
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Could not reach the server" });
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <p className="text-sm text-ink3">
        <a href="/login" className="text-brand transition-colors hover:text-brand-light">
          Sign in
        </a>{" "}
        and back {botName} with at least ${minUsd} to write to it.
      </p>
    );
  }

  if (!eligible) {
    return (
      <p className="text-sm text-ink3">
        Writing to {botName} takes at least <span className="text-ink2">${minUsd}</span> of live
        backing — you have <span className="num text-ink2">${stakeUsd.toFixed(2)}</span>. Skin in
        the game is the whole point.
      </p>
    );
  }

  return (
    <form onSubmit={submit}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={maxChars}
        rows={3}
        aria-label={`Write a note to ${botName}`}
        placeholder={`A suggestion, an observation, a criticism — ${botName} reads it in its next snapshot and answers publicly. No links, no addresses, no instructions.`}
        className="w-full rounded-lg border border-hairline-2 bg-card2 px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-brand"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="th num">
          {text.length}/{maxChars} · one note per day · ${stakeUsd.toFixed(0)} backed
        </span>
        <button
          type="submit"
          disabled={busy || text.trim().length < 8}
          className="btn-primary px-4 py-2 font-display text-sm tracking-tight disabled:opacity-50"
        >
          {busy ? "Screening…" : `Send to ${botName}`}
        </button>
      </div>
      {msg && (
        <p
          className={`mt-3 rounded-lg border px-3 py-2 text-sm text-ink2 ${
            msg.ok ? "border-good/30 bg-good/5" : "border-warn/30 bg-warn/5"
          }`}
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}
