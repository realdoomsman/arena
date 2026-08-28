"use client";

import { useMemo, useState } from "react";
import type { EligibleToken } from "@/lib/bot-universe";

type SortKey =
  | "idx"
  | "priceUsd"
  | "change5m"
  | "change1h"
  | "change24h"
  | "vol1hUsd"
  | "liquidityUsd"
  | "mcapUsd"
  | "holders"
  | "ageHours";

/**
 * The eligible list, explorable.
 *
 * Search and sort are client-side conveniences over the exact server-built
 * list — the idx column never changes with the view, because idx is the one
 * thing a bot actually references and re-numbering it here would make the
 * published list lie.
 */
export function MarketTable({
  list,
  heldBy = {},
}: {
  list: EligibleToken[];
  /** mint → names of bots currently holding it. */
  heldBy?: Record<string, string[]>;
}) {
  const [q, setQ] = useState("");
  const [freshOnly, setFreshOnly] = useState(false);
  const [heldOnly, setHeldOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "idx", dir: 1 });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = list;
    if (needle) {
      rows = rows.filter(
        (t) =>
          t.symbol.toLowerCase().includes(needle) ||
          t.name.toLowerCase().includes(needle) ||
          t.mint.toLowerCase() === needle
      );
    }
    if (freshOnly) rows = rows.filter((t) => t.fresh);
    if (heldOnly) rows = rows.filter((t) => heldBy[t.mint]?.length);
    const { key, dir } = sort;
    return [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // unknowns sink regardless of direction
      if (bv == null) return -1;
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }, [list, q, freshOnly, heldOnly, heldBy, sort]);

  const header = (label: string, key: SortKey, right = true) => {
    const active = sort.key === key;
    return (
      <th className={`px-3 py-2 ${right ? "text-right" : "text-left"}`}>
        <button
          type="button"
          onClick={() =>
            setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : -1 }))
          }
          className={`th transition-colors hover:text-ink ${active ? "text-brand" : ""}`}
        >
          {label}
          {active ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
        </button>
      </th>
    );
  };

  const pctCell = (v: number | null) => (
    <td
      className={`px-3 py-2 text-right num text-[0.72rem] ${
        v == null ? "text-ink4" : v >= 0 ? "text-good" : "text-bad"
      }`}
    >
      {v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
    </td>
  );

  return (
    <div className="card card-glass card-elevated overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline bg-card/50 px-4 py-3 backdrop-blur-sm">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search tokens by symbol, name, or exact mint address"
          placeholder={`Search ${list.length} tokens — symbol, name, or exact mint`}
          className="min-w-[16rem] flex-1 rounded-lg border border-hairline-2 bg-card2 px-3 py-2 font-mono text-xs text-ink outline-none transition-colors focus:border-brand"
        />
        <label className="flex cursor-pointer items-center gap-2 th">
          <input
            type="checkbox"
            checked={freshOnly}
            onChange={(e) => setFreshOnly(e.target.checked)}
            className="accent-[var(--brand)]"
          />
          new launches
        </label>
        <label className="flex cursor-pointer items-center gap-2 th">
          <input
            type="checkbox"
            checked={heldOnly}
            onChange={(e) => setHeldOnly(e.target.checked)}
            className="accent-[var(--brand)]"
          />
          held by bots
        </label>
        <span className="th num">
          {shown.length === list.length ? `${list.length}` : `${shown.length} of ${list.length}`}
        </span>
      </div>

      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[58rem] border-collapse font-mono">
          <thead className="table-sticky">
            <tr className="border-b border-hairline">
              {header("idx", "idx", false)}
              <th className="px-3 py-2 text-left"><span className="th">symbol</span></th>
              <th className="px-3 py-2 text-left"><span className="th">name</span></th>
              {header("price", "priceUsd")}
              {header("5m", "change5m")}
              {header("1h", "change1h")}
              {header("24h", "change24h")}
              {header("vol 1h", "vol1hUsd")}
              {header("liquidity", "liquidityUsd")}
              {header("mcap", "mcapUsd")}
              {header("holders", "holders")}
              {header("age", "ageHours")}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {shown.map((t) => (
              <tr key={t.mint} className="table-row-hover">
                <td className="px-3 py-2 num text-[0.68rem] text-ink3">{t.idx}</td>
                <td className="px-3 py-2">
                  <a
                    href={`/token/${t.mint}`}
                    className="text-[0.8rem] font-medium text-ink transition-colors hover:text-brand"
                  >
                    {t.symbol}
                  </a>
                </td>
                <td className="max-w-[16rem] truncate px-3 py-2 text-[0.66rem] text-ink3">
                  {t.fresh && <span className="mr-1.5 text-warn">NEW</span>}
                  {t.name}
                  {t.launchpad && <span className="ml-1.5">· {t.launchpad}</span>}
                  {heldBy[t.mint]?.length ? (
                    <span className="ml-1.5 text-gold" title={`held by ${heldBy[t.mint].join(", ")}`}>
                      ◆ {heldBy[t.mint].length === 1 ? heldBy[t.mint][0] : `${heldBy[t.mint].length} bots`}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right num text-[0.72rem] text-ink2">
                  ${t.priceUsd.toPrecision(4)}
                </td>
                {pctCell(t.change5m)}
                {pctCell(t.change1h)}
                {pctCell(t.change24h)}
                <td className="px-3 py-2 text-right num text-[0.72rem] text-ink2">
                  {t.vol1hUsd == null ? "—" : `$${Math.round(t.vol1hUsd).toLocaleString()}`}
                </td>
                <td className="px-3 py-2 text-right num text-[0.72rem] text-ink2">
                  ${Math.round(t.liquidityUsd).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right num text-[0.72rem] text-ink3">
                  {t.mcapUsd ? `$${Math.round(t.mcapUsd).toLocaleString()}` : "—"}
                </td>
                <td className="px-3 py-2 text-right num text-[0.72rem] text-ink3">
                  {t.holders ? t.holders.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 text-right num text-[0.72rem] text-ink3">
                  {t.ageHours == null
                    ? "—"
                    : t.ageHours < 1
                      ? `${Math.round(t.ageHours * 60)}m`
                      : t.ageHours < 48
                        ? `${t.ageHours.toFixed(1)}h`
                        : `${Math.round(t.ageHours / 24)}d`}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-sm text-ink3">
                  Nothing matches. The list itself has not changed — only your filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
