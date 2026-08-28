// Market data layer.
// Live prices:   Jupiter lite API  (no key, batched, 30s cache)
// Market stats:  DexScreener       (no key, batched, 2min cache)
// History:       CoinGecko free    (no key, throttled queue, 30min cache)

export type LivePrice = { usdPrice: number; priceChange24h: number | null };
export type MarketStats = {
  /**
   * DexScreener quotes a price in the same response as mcap and volume, so we
   * get it for free in a call we already make. Using it as the display price
   * removes a whole dependency on Jupiter's rate-limited free tier, which was
   * 429-ing and leaving most of the universe with no price at all.
   */
  price: number | null;
  mcap: number | null;
  volume24h: number | null;
  liquidity: number | null;
  priceChange24h: number | null;
};
export type SeriesPoint = [ts: number, value: number];

type CacheEntry<T> = { data: T; ts: number };

export type MarketOverview = {
  cgId: string;
  price: number | null;
  mcap: number | null;
  volume24h: number | null;
  change24h: number | null;
  change7d: number | null;
  sparkline7d: number[];
};

declare global {
   
  var __mbPriceCache: Map<string, CacheEntry<LivePrice>> | undefined;
   
  var __mbStatsCache: Map<string, CacheEntry<MarketStats>> | undefined;
   
  var __mbHistoryCache: Map<string, CacheEntry<SeriesPoint[]>> | undefined;
   
  var __mbCgQueue: Promise<unknown> | undefined;
   
  var __mbMarketsCache: Map<string, CacheEntry<Record<string, MarketOverview>>> | undefined;
   
  var __mbPriceInFlight:
    | Map<string, Promise<Record<string, { usdPrice: number; priceChange24h?: number }>>>
    | undefined;
   
}

const priceCache = (globalThis.__mbPriceCache ??= new Map());
const priceInFlight = (globalThis.__mbPriceInFlight ??= new Map());
const statsCache = (globalThis.__mbStatsCache ??= new Map());
const historyCache = (globalThis.__mbHistoryCache ??= new Map());

const PRICE_TTL = 60_000; // was 30s — halving the refetch rate halves the 429s

/**
 * Jupiter's free tier rate-limits by IP, and every page load wants prices for
 * the whole universe. Firing those batches in parallel got us 429s across the
 * board, which showed up as tokens with no price at all.
 *
 * So every Jupiter price call goes through one global queue, spaced apart, with
 * a single backoff retry. Slower per request, but it actually returns data.
 */
const JUP_GAP_MS = 350;
declare global {
   
  var __mbJupQueue: Promise<unknown> | undefined;
}

async function jupFetch(url: string): Promise<Response> {
  const prev = globalThis.__mbJupQueue ?? Promise.resolve();
  const run = prev.then(async () => {
    let res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (res.status === 429) {
      // One polite retry. If it 429s again the caller falls back to cache.
      await new Promise((r) => setTimeout(r, 1200));
      res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    }
    return res;
  });
  // Keep the chain alive regardless of outcome, and space the next call.
  globalThis.__mbJupQueue = run.then(
    () => new Promise((r) => setTimeout(r, JUP_GAP_MS)),
    () => new Promise((r) => setTimeout(r, JUP_GAP_MS))
  );
  return run;
}
const STATS_TTL = 120_000;
const HISTORY_TTL = 30 * 60_000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Batched live prices from Jupiter. Falls back to stale cache on failure —
 * unbounded for display paths, capped via `maxStaleMs` for trade execution.
 */
export async function getPrices(
  mints: string[],
  opts: { maxStaleMs?: number } = {}
): Promise<Record<string, LivePrice>> {
  const unique = [...new Set(mints)];
  const now = Date.now();
  const result: Record<string, LivePrice> = {};
  const missing: string[] = [];

  for (const mint of unique) {
    const hit = priceCache.get(mint);
    if (hit && now - hit.ts < PRICE_TTL) result[mint] = hit.data;
    else missing.push(mint);
  }

  if (missing.length > 0) {
    await Promise.all(
      chunk(missing, 30).map(async (group) => {
        try {
          // Coalesce concurrent cold callers onto one upstream request per
          // chunk — otherwise every request in a burst stampedes Jupiter.
          const flightKey = group.join(",");
          let flight = priceInFlight.get(flightKey);
          if (!flight) {
            flight = jupFetch(`https://lite-api.jup.ag/price/v3?ids=${flightKey}`)
              .then(async (res) => {
                if (!res.ok) throw new Error(`jupiter ${res.status}`);
                return (await res.json()) as Record<
                  string,
                  { usdPrice: number; priceChange24h?: number }
                >;
              })
              .finally(() => priceInFlight.delete(flightKey));
            priceInFlight.set(flightKey, flight);
          }
          const data = await flight;
          for (const mint of group) {
            const p = data[mint];
            if (p && Number.isFinite(p.usdPrice)) {
              const entry: LivePrice = {
                usdPrice: p.usdPrice,
                priceChange24h: Number.isFinite(p.priceChange24h) ? p.priceChange24h! : null,
              };
              priceCache.set(mint, { data: entry, ts: now });
              result[mint] = entry;
            }
          }
        } catch (e) {
          // Log it. Swallowing this silently is how 44 tokens ended up
          // showing no price with nothing at all in the logs to explain it.
          console.error(
            `[prices] batch of ${group.length} failed:`,
            e instanceof Error ? e.message : e
          );
        }
        // Stale fallback for anything still unpriced — this must run on BOTH
        // paths: a 200 that simply omits the mint (delisted, low liquidity)
        // is just as "unavailable" as a network failure.
        for (const mint of group) {
          if (result[mint]) continue;
          const stale = priceCache.get(mint);
          if (stale && (opts.maxStaleMs == null || now - stale.ts <= opts.maxStaleMs)) {
            result[mint] = stale.data;
          }
        }
      })
    );
  }
  return result;
}

/** Market cap / volume / liquidity from DexScreener (best pair by liquidity). */
export async function getMarketStats(mints: string[]): Promise<Record<string, MarketStats>> {
  const unique = [...new Set(mints)];
  const now = Date.now();
  const result: Record<string, MarketStats> = {};
  const missing: string[] = [];

  for (const mint of unique) {
    const hit = statsCache.get(mint);
    if (hit && now - hit.ts < STATS_TTL) result[mint] = hit.data;
    else missing.push(mint);
  }

  if (missing.length > 0) {
    await Promise.all(
      chunk(missing, 30).map(async (group) => {
        try {
          const res = await fetch(
            `https://api.dexscreener.com/tokens/v1/solana/${group.join(",")}`,
            { signal: AbortSignal.timeout(10_000), cache: "no-store" }
          );
          if (!res.ok) throw new Error(`dexscreener ${res.status}`);
          const pairs = (await res.json()) as Array<{
            priceUsd?: string;
            baseToken?: { address?: string };
            liquidity?: { usd?: number };
            volume?: { h24?: number };
            priceChange?: { h24?: number };
            marketCap?: number;
            fdv?: number;
          }>;
          const best = new Map<string, (typeof pairs)[number]>();
          for (const pair of pairs ?? []) {
            const addr = pair.baseToken?.address;
            if (!addr || !group.includes(addr)) continue;
            const prev = best.get(addr);
            if (!prev || (pair.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) {
              best.set(addr, pair);
            }
          }
          for (const mint of group) {
            const pair = best.get(mint);
            const px = pair?.priceUsd != null ? Number(pair.priceUsd) : null;
            const entry: MarketStats = {
              price: px != null && Number.isFinite(px) && px > 0 ? px : null,
              mcap: pair?.marketCap ?? pair?.fdv ?? null,
              volume24h: pair?.volume?.h24 ?? null,
              liquidity: pair?.liquidity?.usd ?? null,
              priceChange24h: pair?.priceChange?.h24 ?? null,
            };
            statsCache.set(mint, { data: entry, ts: now });
            result[mint] = entry;
          }
        } catch {
          for (const mint of group) {
            const stale = statsCache.get(mint);
            if (stale) result[mint] = stale.data;
          }
        }
      })
    );
  }
  return result;
}

/**
 * CoinGecko fetch queue. Takes an API PATH (e.g. "/coins/markets?...").
 * A configured key may be Pro or Demo — the client auto-detects: on the
 * key-mismatch 400s (10010/10011) it flips host+header and retries once.
 * Keyless stays conservatively serialized.
 */
declare global {
   
  var __mbCgPro: boolean | undefined;
}

async function cgRequest(path: string): Promise<Response> {
  const apiKey = process.env.COINGECKO_API_KEY;
  const doFetch = (pro: boolean) =>
    fetch(
      `${pro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3"}${path}`,
      {
        headers: {
          accept: "application/json",
          ...(apiKey ? { [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: apiKey } : {}),
        },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      }
    );
  let pro = globalThis.__mbCgPro ?? false;
  let res = await doFetch(pro);
  if (apiKey && res.status === 400) {
    const body = await res.text();
    if (body.includes("10010") || body.includes("10011") || body.includes("pro-api")) {
      pro = !pro;
      globalThis.__mbCgPro = pro;
      res = await doFetch(pro);
    }
  }
  return res;
}

function cgFetch(path: string): Promise<unknown> {
  const apiKey = process.env.COINGECKO_API_KEY;
  const gapMs = apiKey ? 150 : 1500;
  const queue = globalThis.__mbCgQueue ?? Promise.resolve();
  const run = queue.then(async () => {
    const res = await cgRequest(path);
    if (!res.ok) throw new Error(`coingecko ${res.status}`);
    return res.json();
  });
  globalThis.__mbCgQueue = run.then(
    () => new Promise((r) => setTimeout(r, gapMs)),
    () => new Promise((r) => setTimeout(r, gapMs))
  );
  return run;
}

/** Price history for one token, [ts, usd][]. Empty array = unavailable. */
export async function getHistory(coingeckoId: string, days: number): Promise<SeriesPoint[]> {
  const key = `${coingeckoId}:${days}`;
  const hit = historyCache.get(key);
  const now = Date.now();
  if (hit && now - hit.ts < HISTORY_TTL) return hit.data;
  try {
    const data = (await cgFetch(
      `/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}`
    )) as { prices?: [number, number][] };
    const points: SeriesPoint[] = (data.prices ?? []).filter(
      (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
    );
    if (points.length >= 2) {
      historyCache.set(key, { data: points, ts: now });
      return points;
    }
    return hit?.data ?? [];
  } catch {
    return hit?.data ?? []; // stale beats nothing; empty means "no chart"
  }
}

// ---------- per-token deep detail (Jupiter token search) ----------

export type TokenDetail = {
  symbol: string | null;
  name: string | null;
  /** The token's real artwork, straight from Jupiter — not a guessed CDN path. */
  icon: string | null;
  holderCount: number | null;
  organicScore: number | null;
  topHoldersPct: number | null;
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  buys24h: number | null;
  sells24h: number | null;
  traders24h: number | null;
  createdAt: string | null;
};

declare global {
   
  var __mbDetailCache: Map<string, CacheEntry<TokenDetail>> | undefined;
}
const detailCache = (globalThis.__mbDetailCache ??= new Map());
const DETAIL_TTL = 5 * 60_000;

export async function getTokenDetail(mint: string): Promise<TokenDetail | null> {
  const hit = detailCache.get(mint);
  if (hit && Date.now() - hit.ts < DETAIL_TTL) return hit.data;
  try {
    const res = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`,
      { signal: AbortSignal.timeout(10_000), cache: "no-store" }
    );
    if (!res.ok) throw new Error(`jupiter ${res.status}`);
    const list = (await res.json()) as Array<{
      id: string;
      symbol?: string;
      name?: string;
      icon?: string;
      holderCount?: number;
      organicScore?: number;
      firstPool?: { createdAt?: string };
      audit?: {
        mintAuthorityDisabled?: boolean;
        freezeAuthorityDisabled?: boolean;
        topHoldersPercentage?: number;
      };
      stats24h?: { numBuys?: number; numSells?: number; numTraders?: number };
    }>;
    const t = list?.find((x) => x.id === mint);
    if (!t) return hit?.data ?? null;
    const detail: TokenDetail = {
      symbol: t.symbol ?? null,
      name: t.name ?? null,
      icon: t.icon?.trim() || null,
      holderCount: t.holderCount ?? null,
      organicScore: t.organicScore != null ? Math.round(t.organicScore) : null,
      topHoldersPct: t.audit?.topHoldersPercentage ?? null,
      mintAuthorityDisabled: t.audit?.mintAuthorityDisabled ?? null,
      freezeAuthorityDisabled: t.audit?.freezeAuthorityDisabled ?? null,
      buys24h: t.stats24h?.numBuys ?? null,
      sells24h: t.stats24h?.numSells ?? null,
      traders24h: t.stats24h?.numTraders ?? null,
      createdAt: t.firstPool?.createdAt ?? null,
    };
    detailCache.set(mint, { data: detail, ts: Date.now() });
    return detail;
  } catch {
    return hit?.data ?? null;
  }
}


// ── Price history, from GeckoTerminal ───────────────────────────────────────
// Hourly closes for the last week, via the token's top pool. Keyless. Used
// only for display — trading marks always come from getPrices, so a chart
// outage can never move a valuation.

export type PricePoint = [ts: number, close: number];

declare global {
   
  var __mbOhlcvCache: Map<string, { ts: number; data: PricePoint[] | null }> | undefined;
}
const ohlcvCache = (globalThis.__mbOhlcvCache ??= new Map());
/** Hourly candles don't move in minutes; a long success TTL spends the shared
 *  rate budget on tokens not yet charted instead of refreshing ones that are. */
const OHLCV_HIT_TTL = 15 * 60_000;
const OHLCV_MISS_TTL = 5 * 60_000;

export async function getTokenOhlcv(mint: string): Promise<PricePoint[] | null> {
  const hit = ohlcvCache.get(mint);
  if (hit && Date.now() - hit.ts < (hit.data ? OHLCV_HIT_TTL : OHLCV_MISS_TTL)) return hit.data;

  // GeckoTerminal's free tier enforces a BURST limit as well as 30/min, and a
  // page render often lands right after a universe rebuild burned four calls.
  // One short-fused retry absorbs the burst 429 without meaningfully delaying
  // the page; a sustained 429 still falls through to the cached miss.
  const fetchJson = async (path: string) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://api.geckoterminal.com/api/v2/${path}`, {
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (res.ok) return res.json();
      if (res.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw new Error(`geckoterminal ${res.status}`);
    }
  };

  try {
    const pools = (await fetchJson(`networks/solana/tokens/${mint}/pools?page=1`)) as {
      data?: { attributes?: { address?: string } }[];
    };
    const pool = pools.data?.[0]?.attributes?.address;
    if (!pool) throw new Error("no pool");

    const ohlcv = (await fetchJson(
      `networks/solana/pools/${pool}/ohlcv/hour?aggregate=1&limit=168&currency=usd`
    )) as { data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } } };
    const rows = ohlcv.data?.attributes?.ohlcv_list ?? [];
    const points: PricePoint[] = rows
      .map((r): PricePoint => [r[0] * 1000, r[4]])
      .filter((p) => Number.isFinite(p[1]) && p[1] > 0)
      .sort((a, b) => a[0] - b[0]);
    const data = points.length >= 2 ? points : null;
    ohlcvCache.set(mint, { ts: Date.now(), data });
    return data;
  } catch (e) {
    // Logged, not swallowed: a silently chartless page and a rate-limited
    // feed look identical without this line.
    console.warn(`[ohlcv] ${mint.slice(0, 8)}… failed:`, e instanceof Error ? e.message : e);
    // Cache the miss too — a token with no pool would otherwise re-probe on
    // every page view.
    ohlcvCache.set(mint, { ts: Date.now(), data: hit?.data ?? null });
    return hit?.data ?? null;
  }
}
