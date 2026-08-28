// Tracks trades that are between "swap sent on-chain" and "ledger committed".
//
// A Railway deploy SIGTERMs the old container, and Next's default handler
// exits after draining HTTP requests only — an engine tick or a leg pool is
// not an HTTP request, so it was killed at whatever await it was on. Dying
// between a confirmed swap and its ledger COMMIT is the one window that
// corrupts the books: the sale is real on-chain but invisible in the app.
// Shutdown (see instrumentation.ts) waits for this counter to hit zero.
declare global {
   
  var __bInflight: number | undefined;
   
  var __bDraining: boolean | undefined;
}

export function enterCritical(): void {
  globalThis.__bInflight = (globalThis.__bInflight ?? 0) + 1;
}

export function exitCritical(): void {
  globalThis.__bInflight = Math.max(0, (globalThis.__bInflight ?? 1) - 1);
}

/** True once shutdown has begun — no NEW trade work may start. */
export function isDraining(): boolean {
  return !!globalThis.__bDraining;
}

/**
 * Flag the process as draining and wait (bounded) for every in-flight
 * critical section to finish. Idempotent; safe to call from a signal handler.
 */
export async function drainAndWait(maxWaitMs: number): Promise<void> {
  globalThis.__bDraining = true;
  const deadline = Date.now() + maxWaitMs;
  while ((globalThis.__bInflight ?? 0) > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  const left = globalThis.__bInflight ?? 0;
  if (left > 0) {
    console.error(`[shutdown] giving up with ${left} trade(s) still in flight after ${maxWaitMs}ms`);
  }
}
