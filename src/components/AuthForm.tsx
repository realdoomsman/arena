"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Sign in and sign up in one form.
 *
 * Errors are shown exactly as the server phrased them — the API is careful not
 * to leak whether an account exists, and paraphrasing here would risk undoing
 * that.
 */
export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "login" ? { email, password } : { email, username, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.push("/account");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-3">
      <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
      {mode === "register" && (
        <Field label="Username" type="text" value={username} onChange={setUsername} autoComplete="username" />
      )}
      <Field
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete={mode === "login" ? "current-password" : "new-password"}
      />

      {error && (
        <p className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-ink2">{error}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="btn-primary mt-2 rounded-xl px-4 py-2.5 font-display text-sm tracking-tight disabled:opacity-50"
      >
        {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
      </button>

      <button
        type="button"
        className="mt-1 text-left font-mono text-[0.7rem] text-ink3 hover:text-ink2"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError(null);
        }}
      >
        {mode === "login" ? "No account? Create one" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-ink3">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-hairline-2 bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-brand"
      />
    </label>
  );
}
