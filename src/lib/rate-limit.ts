// In-process request throttling. Deliberately dependency-free so anything —
// routes, libs, tests — can use it without dragging the Next runtime along.

declare global {
   
  var __aRateBuckets: Map<string, { n: number; resetAt: number }> | undefined;
}

const rateBuckets = (globalThis.__aRateBuckets ??= new Map<string, { n: number; resetAt: number }>());

/**
 * Fixed-window in-process rate limit. Enough to stop online brute force and
 * signup CPU-burn on the single-process deployment this app is designed for.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (rateBuckets.size > 10_000) {
    for (const [k, b] of rateBuckets) if (b.resetAt <= now) rateBuckets.delete(k);
  }
  const b = rateBuckets.get(key);
  if (!b || b.resetAt <= now) {
    rateBuckets.set(key, { n: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.n >= limit) return false;
  b.n++;
  return true;
}

/** Best-effort client address for rate-limit keys. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "local";
}
