"use client";

import { useEffect, useState } from "react";

type PricePoint = [ts: number, close: number];

/**
 * A week of hourly closes, fetched from GeckoTerminal BY THE VISITOR'S OWN
 * BROWSER. Server-side charting died on arrival: the host's egress IP is
 * shared across the platform's tenants, so the keyless rate limit there is
 * everyone's, permanently exhausted. Each visitor's IP has its own budget,
 * and the API sends `access-control-allow-origin: *` on purpose.
 *
 * Display only — trading valuations never read from here. Real data or
 * nothing: on any failure the component renders nothing rather than a
 * placeholder line pretending to be a market.
 */
export function PriceChart({ mint }: { mint: string }) {
  const [points, setPoints] = useState<PricePoint[] | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const base = "https://api.geckoterminal.com/api/v2/networks/solana";
        const pools = (await (
          await fetch(`${base}/tokens/${mint}/pools?page=1`, { signal: AbortSignal.timeout(10_000) })
        ).json()) as { data?: { attributes?: { address?: string } }[] };
        const pool = pools.data?.[0]?.attributes?.address;
        if (!pool) return;

        const ohlcv = (await (
          await fetch(`${base}/pools/${pool}/ohlcv/hour?aggregate=1&limit=168&currency=usd`, {
            signal: AbortSignal.timeout(10_000),
          })
        ).json()) as {
          data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } };
        };
        const rows = ohlcv.data?.attributes?.ohlcv_list ?? [];
        const pts: PricePoint[] = rows
          .map((r): PricePoint => [r[0] * 1000, r[4]])
          .filter((p) => Number.isFinite(p[1]) && p[1] > 0)
          .sort((a, b) => a[0] - b[0]);
        if (!dead && pts.length >= 2) setPoints(pts);
      } catch {
        /* no chart beats a fake chart */
      }
    })();
    return () => {
      dead = true;
    };
  }, [mint]);

  if (!points) return null;

  const values = points.map((p) => p[1]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, min * 1e-9, 1e-18);
  const first = values[0];
  const last = values[values.length - 1];
  const change = first > 0 ? (last / first - 1) * 100 : 0;
  const up = change >= 0;

  const W = 720;
  const H = 180;
  const PAD = 6;
  const t0 = points[0][0];
  const tSpan = Math.max(points[points.length - 1][0] - t0, 1);
  const path = points
    .map((p) => {
      const x = PAD + ((p[0] - t0) / tSpan) * (W - PAD * 2);
      const y = H - PAD - ((p[1] - min) / span) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const days = (points[points.length - 1][0] - t0) / 86_400_000;
  const price = (v: number) => (v >= 1 ? v.toFixed(2) : v.toPrecision(3));

  return (
    <div className="card mt-4 p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-4">
        <span className={`num text-lg font-semibold ${up ? "text-good" : "text-bad"}`}>
          {up ? "+" : ""}
          {change.toFixed(1)}%
        </span>
        <span className="th">
          {days >= 1.5 ? `${Math.round(days)}d` : `${Math.round(days * 24)}h`} · hourly closes ·
          geckoterminal
        </span>
        <span className="th ml-auto num">
          hi ${price(max)} · lo ${price(min)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[20rem]"
          role="img"
          aria-label={`Price over ${Math.round(days)} days: ${change.toFixed(1)} percent`}
        >
          <polyline
            points={path}
            fill="none"
            stroke={up ? "var(--good)" : "var(--bad)"}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
