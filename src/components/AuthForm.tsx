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
export function AuthForm({ googleEnabled = false }: { googleEnabled?: boolean }) {
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
    <div className="mt-6">
      {googleEnabled && (
        <>
          <a
            href="/api/auth/google"
            className="btn-secondary flex items-center justify-center gap-2.5 rounded-lg px-4 py-2.5 text-sm font-medium"
          >
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Continue with Google
          </a>
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-hairline" />
            <span className="th">or with email</span>
            <div className="h-px flex-1 bg-hairline" />
          </div>
        </>
      )}
      <form onSubmit={submit} className="flex flex-col gap-3">
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
    </div>
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
