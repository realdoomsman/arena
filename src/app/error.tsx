"use client";

import { useEffect } from "react";

/**
 * Something broke while rendering.
 *
 * Deliberately does not pretend to know what. It logs the digest so a real
 * cause can be found in the server output, and offers a retry — most failures
 * here are a transient upstream (a price feed, an RPC) rather than a bug in
 * the page.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[render]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-20 font-mono text-sm">
      <p className="text-[0.7rem] uppercase tracking-[0.14em] text-bad">error</p>
      <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">This page did not load</h1>
      <p className="mt-3 text-ink2">
        Usually an upstream data source timing out rather than anything permanent. No money
        moves from a page that failed to render.
      </p>
      {error.digest && (
        <p className="mt-2 text-[0.68rem] text-ink3">digest {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="mt-5 border border-hairline-2 px-3 py-1.5 text-xs text-ink2 hover:border-brand hover:text-ink"
      >
        try again
      </button>
    </div>
  );
}
