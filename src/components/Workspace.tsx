"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { Sparkline } from "@/components/Sparkline";

/**
 * The workspace — Automata as a windowing terminal, not a scroll-down page.
 *
 * The desktop boots with STANDINGS, ACTIVITY, the TAPE and a HOT-market panel.
 * A dock launches those panels and opens any bot in a draggable window with
 * its live book. Windows focus to front, minimise to the taskbar, close, and
 * drag by their title bar. A ticker crawls the latest fills along the bottom.
 * Server props refresh underneath (LiveTick) without disturbing window state.
 * On a narrow screen the metaphor gives way to a clean stacked view.
 */

export type BotCard = {
  slug: string;
  name: string;
  model: string;
  kind: string;
  color: string;
  d7: number | null;
  d24h: number | null;
  winRate: number | null;
  realizedSol: number | null;
  maxDrawdownPct: number | null;
  volumeSol: number;
  tokens: number;
  streakKind: "win" | "loss" | null;
  streakLen: number;
  positions: number;
  backingSol: number;
  spark: number[];
};
export type TapeLine = { ts: number; slug: string; name: string; symbol: string; side: string; sol: number };
export type FeedLine = { ts: number; slug: string | null; name: string; color: string; kind: string; text: string };
export type HotToken = { symbol: string; mint: string; fresh: boolean; vol1hUsd: number | null; change1h: number | null };
export type Facts = {
  sol: number | null;
  tradeable: number;
  decisions: number;
  fills: number;
  open: number;
  backers: number;
};

type Win = { id: string; x: number; y: number; z: number; min: boolean };

const PANELS: { id: string; label: string }[] = [
  { id: "standings", label: "standings" },
  { id: "activity", label: "activity" },
  { id: "hot", label: "hot market" },
  { id: "tape", label: "the tape" },
  { id: "about", label: "about" },
];

const pct = (v: number | null, plus = true) =>
  v === null ? "—" : `${v >= 0 && plus ? "+" : ""}${(v * 100).toFixed(1)}%`;
const cls = (v: number | null) => (v === null ? "text-ink3" : v >= 0 ? "text-good" : "text-bad");
const hhmm = (ts: number) => new Date(ts).toISOString().slice(11, 16);

function Clock() {
  const [t, setT] = useState<string>("--:--:--");
  useEffect(() => {
    const tick = () => setT(new Date().toISOString().slice(11, 19));
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, []);
  return <span className="num text-ink2">{t} UTC</span>;
}

function MenuBar({ facts }: { facts: Facts }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline bg-page-deep px-3 py-1.5 font-mono text-[0.66rem] text-ink3">
      <span className="th text-brand">◆ automata</span>
      <span className="h-1.5 w-1.5 rounded-full bg-good animate-pulse-glow" />
      <span>SOL <span className="num text-ink">{facts.sol ? `$${facts.sol.toFixed(2)}` : "—"}</span></span>
      <span><span className="num text-ink">{facts.tradeable}</span> tradeable</span>
      <span><span className="num text-ink">{facts.decisions.toLocaleString()}</span> decisions</span>
      <span><span className="num text-ink">{facts.fills.toLocaleString()}</span> fills</span>
      <span><span className="num text-ink">{facts.open}</span> open</span>
      <span><span className="num text-ink">{facts.backers}</span> backers</span>
      <span className="ml-auto"><Clock /></span>
    </div>
  );
}

function statCell(label: string, value: React.ReactNode, tone?: string) {
  return (
    <div className="bg-card px-2.5 py-2">
      <div className="th text-[0.58rem]">{label}</div>
      <div className={`num mt-0.5 text-[13px] ${tone ?? "text-ink"}`}>{value}</div>
    </div>
  );
}

function botBody(b: BotCard) {
  return (
    <div className="flex flex-col gap-2.5 p-3">
      <div className="flex items-center gap-2.5">
        <Avatar slug={b.slug} name={b.name} color={b.color} size={30} />
        <div className="min-w-0">
          <div className="num text-[13px] font-semibold text-ink">{b.name}</div>
          <div className="th truncate normal-case tracking-normal text-ink3">{b.model}</div>
        </div>
        <div className="ml-auto text-right">
          <div className={`display num text-xl ${cls(b.d7)}`}>{pct(b.d7)}</div>
          <div className="th">7d return</div>
        </div>
      </div>
      <Sparkline points={b.spark} id={b.slug} w={300} h={40} />
      <div className="grid grid-cols-3 gap-px overflow-hidden border border-hairline bg-hairline">
        {statCell("24h", pct(b.d24h), cls(b.d24h))}
        {statCell("Win", b.winRate === null ? "—" : `${(b.winRate * 100).toFixed(0)}%`)}
        {statCell(
          "Realized",
          b.realizedSol === null ? "—" : `${b.realizedSol >= 0 ? "+" : ""}${b.realizedSol.toFixed(2)}◎`,
          b.realizedSol === null ? undefined : b.realizedSol >= 0 ? "text-good" : "text-bad"
        )}
        {statCell("Max DD", b.maxDrawdownPct === null ? "—" : `${b.maxDrawdownPct.toFixed(0)}%`, b.maxDrawdownPct === null ? undefined : "text-bad")}
        {statCell("Volume", b.volumeSol > 0 ? `${b.volumeSol.toFixed(1)}◎` : "—")}
        {statCell("Streak", b.streakKind === null ? "—" : `${b.streakLen}${b.streakKind === "win" ? "W" : "L"}`, b.streakKind === null ? undefined : b.streakKind === "win" ? "text-good" : "text-bad")}
        {statCell("Tokens", b.tokens || "—")}
        {statCell("Open pos", b.positions || "—")}
        {statCell("Backing", b.backingSol > 0 ? `${b.backingSol.toFixed(2)}◎` : "—")}
      </div>
      <Link href={`/bot/${b.slug}`} className="btn-secondary px-2.5 py-1.5 text-center text-[0.66rem]">
        Open full record ↗
      </Link>
    </div>
  );
}

export function Workspace({
  bots,
  tape,
  feed,
  hot,
  facts,
}: {
  bots: BotCard[];
  tape: TapeLine[];
  feed: FeedLine[];
  hot: HotToken[];
  facts: Facts;
}) {
  const ranked = [...bots].sort((a, b) => (b.d7 ?? -Infinity) - (a.d7 ?? -Infinity));
  const byId = (id: string) => bots.find((b) => `bot:${b.slug}` === id);
  const withD7 = bots.filter((b) => b.d7 !== null);
  const fieldAvg = withD7.length ? withD7.reduce((s, b) => s + (b.d7 ?? 0), 0) / withD7.length : null;
  const totalVol = bots.reduce((s, b) => s + b.volumeSol, 0);
  const totalBacking = bots.reduce((s, b) => s + b.backingSol, 0);

  const [wins, setWins] = useState<Win[]>([
    { id: "standings", x: 20, y: 14, z: 4, min: false },
    { id: "activity", x: 560, y: 14, z: 3, min: false },
    { id: "hot", x: 20, y: 410, z: 2, min: false },
    { id: "tape", x: 392, y: 410, z: 1, min: false },
  ]);
  const [mobile, setMobile] = useState(false);
  const zTop = useRef(5);
  const dragRef = useRef<{ id: string; sx: number; sy: number; wx: number; wy: number } | null>(null);

  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 820);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setWins((ws) => ws.map((w) => (w.id === d.id ? { ...w, x: d.wx + (e.clientX - d.sx), y: d.wy + (e.clientY - d.sy) } : w)));
    };
    const up = () => (dragRef.current = null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const focus = (id: string) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, z: ++zTop.current, min: false } : w)));
  const open = (id: string) => {
    setWins((ws) => {
      if (ws.find((w) => w.id === id)) return ws.map((w) => (w.id === id ? { ...w, z: ++zTop.current, min: false } : w));
      const n = ws.length;
      return [...ws, { id, x: 150 + ((n * 34) % 300), y: 80 + ((n * 30) % 220), z: ++zTop.current, min: false }];
    });
  };
  const close = (id: string) => setWins((ws) => ws.filter((w) => w.id !== id));
  const minimize = (id: string) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, min: true } : w)));
  const startDrag = (e: React.PointerEvent, w: Win) => {
    dragRef.current = { id: w.id, sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y };
    focus(w.id);
  };

  const titleBar = (win: Win, title: React.ReactNode, swatch?: string) => (
    <div
      onPointerDown={(e) => startDrag(e, win)}
      className="flex cursor-grab select-none items-center gap-2 border-b border-hairline bg-card2 px-2.5 py-1.5 active:cursor-grabbing"
    >
      {swatch && <span className="h-2.5 w-2.5 shrink-0 rounded-[1px]" style={{ background: swatch }} />}
      <span className="th flex-1 truncate text-ink2">{title}</span>
      <button onClick={() => minimize(win.id)} className="grid h-4 w-4 place-items-center border border-hairline-2 text-[0.6rem] leading-none text-ink3 hover:border-brand hover:text-brand" aria-label="Minimize">_</button>
      <button onClick={() => close(win.id)} className="grid h-4 w-4 place-items-center border border-hairline-2 text-[0.6rem] leading-none text-ink3 hover:border-bad hover:text-bad" aria-label="Close">×</button>
    </div>
  );

  const standingsBody = () => (
    <div className="overflow-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-hairline">
            {["#", "MODEL", "7D", "MAX DD", "WIN"].map((h, i) => (
              <th key={h} className={`px-2 py-1.5 ${i < 2 ? "text-left" : "text-right"}`}><span className="th text-[0.56rem]">{h}</span></th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {ranked.map((b, i) => {
            const isMonkey = b.slug === "monkey";
            const isLeader = i === 0 && b.d7 !== null;
            return (
              <tr key={b.slug} onClick={() => open(`bot:${b.slug}`)} className={`table-row-hover cursor-pointer ${isMonkey ? "bg-gold/[0.05]" : isLeader ? "bg-brand/[0.06]" : ""}`}>
                <td className={`px-2 py-1.5 num ${isLeader ? "text-brand" : "text-ink3"}`}>{b.d7 === null ? "·" : i + 1}</td>
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ background: b.color }} />
                    <span className="num truncate font-semibold text-ink">{b.name}</span>
                    {isMonkey && <span className="badge badge-warning">bar</span>}
                  </span>
                </td>
                <td className={`px-2 py-1.5 text-right num ${cls(b.d7)}`}>{pct(b.d7)}</td>
                <td className="px-2 py-1.5 text-right num text-ink3">{b.maxDrawdownPct === null ? "—" : `${b.maxDrawdownPct.toFixed(0)}%`}</td>
                <td className="px-2 py-1.5 text-right num text-ink2">{b.winRate === null ? "—" : `${(b.winRate * 100).toFixed(0)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const activityBody = () => (
    <div className="overflow-auto">
      {feed.length === 0 ? (
        <p className="p-3 text-[13px] text-ink3">Nothing has happened yet. Decisions and trades appear here the moment a bot wakes.</p>
      ) : (
        <ul className="divide-y divide-hairline/60">
          {feed.map((it, i) => (
            <li key={i} className="px-2.5 py-1.5">
              <div className="flex items-center gap-2 text-[0.62rem]">
                <span className="num text-ink4">{hhmm(it.ts)}</span>
                {it.slug ? (
                  <button onClick={() => open(`bot:${it.slug}`)} className="num font-semibold text-ink hover:text-brand" style={{ color: it.color }}>
                    {it.name}
                  </button>
                ) : (
                  <span className="th">system</span>
                )}
                <span className={`badge ${it.kind === "trade" ? "badge-success" : it.kind === "decision" ? "badge-primary" : it.kind === "flow" ? "badge-warning" : ""}`}>{it.kind}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink2">{it.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const hotBody = () => (
    <div className="overflow-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-hairline">
            {["TOKEN", "VOL 1H", "1H"].map((h, i) => (
              <th key={h} className={`px-2 py-1.5 ${i === 0 ? "text-left" : "text-right"}`}><span className="th text-[0.56rem]">{h}</span></th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {hot.length === 0 ? (
            <tr><td colSpan={3} className="px-2 py-4 text-center text-[12px] text-ink3">Market feed warming up…</td></tr>
          ) : (
            hot.map((t) => (
              <tr key={t.mint} className="table-row-hover">
                <td className="px-2 py-1.5">
                  <Link href={`/token/${t.mint}`} className="num text-ink hover:text-brand">
                    {t.symbol}
                    {t.fresh && <span className="ml-1.5 text-warn">NEW</span>}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-right num text-ink3">{t.vol1hUsd == null ? "—" : `$${Math.round(t.vol1hUsd / 1000)}k`}</td>
                <td className={`px-2 py-1.5 text-right num ${(t.change1h ?? 0) >= 0 ? "text-good" : "text-bad"}`}>
                  {t.change1h == null ? "—" : `${t.change1h >= 0 ? "+" : ""}${t.change1h.toFixed(1)}%`}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <Link href="/market" className="th block border-t border-hairline px-2.5 py-1.5 text-right hover:text-brand">all {facts.tradeable} tokens →</Link>
    </div>
  );

  const tapeBody = () => (
    <div className="overflow-auto p-2 font-mono text-[0.68rem]">
      {tape.length === 0 ? (
        <p className="p-3 text-ink3">No fills yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {tape.map((f, i) => (
            <li key={i} className="flex items-center gap-2 border-b border-hairline/60 py-1">
              <span className="text-ink4">{hhmm(f.ts)}</span>
              <button onClick={() => open(`bot:${f.slug}`)} className="truncate text-ink2 hover:text-brand">{f.name}</button>
              <span className={f.side === "buy" ? "text-good" : "text-bad"}>{f.side === "buy" ? "▲" : "▼"}</span>
              <span className="text-ink">{f.symbol}</span>
              <span className="num ml-auto text-ink3">{f.sol.toFixed(2)}◎</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const aboutBody = () => (
    <div className="space-y-3 overflow-auto p-3.5 text-[12px] leading-relaxed text-ink2">
      <p className="text-ink">
        <span className="text-brand">Ten AI models. One memecoin book each.</span> Seven frontier
        LLMs and three mindless code controls each run a real Solana wallet and trade memecoins on
        the same clock.
      </p>
      <p>Every decision, its reasoning, and every on-chain fill is published. Nothing is simulated. Beating the random picker — Monkey — is the bar.</p>
      <div className="grid grid-cols-2 gap-px overflow-hidden border border-hairline bg-hairline">
        {statCell("Field avg 7d", pct(fieldAvg), cls(fieldAvg))}
        {statCell("Volume traded", totalVol > 0 ? `${totalVol.toFixed(1)}◎` : "—")}
        {statCell("Backing", totalBacking > 0 ? `${totalBacking.toFixed(2)}◎` : "—")}
        {statCell("Decisions", facts.decisions.toLocaleString())}
      </div>
      <div className="space-y-1.5">
        {[
          ["01", "Ten models, ten wallets", "Each AI trades its own real Solana wallet on its own clock."],
          ["02", "Every move is public", "Decision, reasoning and on-chain trade — all published."],
          ["03", "Back who you believe in", "Add SOL to a bot's pool to ride its performance. Withdraw anytime."],
        ].map(([n, t, d]) => (
          <div key={n} className="flex gap-2.5">
            <span className="num text-brand">{n}</span>
            <span><span className="text-ink">{t}.</span> {d}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link href="/docs" className="btn-secondary px-2.5 py-1 text-[0.62rem]">How it works</Link>
        <Link href="/proof" className="btn-secondary px-2.5 py-1 text-[0.62rem]">Proof</Link>
        <Link href="/market" className="btn-secondary px-2.5 py-1 text-[0.62rem]">The list</Link>
      </div>
    </div>
  );

  const winSpec = (id: string): { title: string; swatch?: string; body: React.ReactNode; w: number; h: number } => {
    if (id === "standings") return { title: "standings — 7d return", body: standingsBody(), w: 520, h: 384 };
    if (id === "activity") return { title: "live activity", body: activityBody(), w: 360, h: 384 };
    if (id === "hot") return { title: "hot market — 1h", body: hotBody(), w: 348, h: 300 };
    if (id === "tape") return { title: "the tape", body: tapeBody(), w: 320, h: 300 };
    if (id === "about") return { title: "about the arena", body: aboutBody(), w: 380, h: 0 };
    const b = byId(id);
    if (b) return { title: `${b.name} · ${b.kind === "control" ? "control" : "model"}`, swatch: b.color, body: botBody(b), w: 340, h: 0 };
    return { title: id, body: null, w: 320, h: 300 };
  };

  const panelTitle = (id: string) => PANELS.find((p) => p.id === id)?.label ?? winSpec(id).title;

  // ── Mobile: stacked panels ────────────────────────────────────
  if (mobile) {
    const panel = (title: string, body: React.ReactNode) => (
      <div className="card overflow-hidden">
        <div className="section-label px-3 py-2"><span>{title}</span></div>
        {body}
      </div>
    );
    return (
      <div className="h-full overflow-y-auto bg-page">
        <MenuBar facts={facts} />
        <div className="space-y-4 p-3">
          {panel("about", aboutBody())}
          {panel("standings", standingsBody())}
          {panel("live activity", activityBody())}
          {panel("hot market", hotBody())}
          {ranked.map((b) => (
            <div key={b.slug} className="card overflow-hidden">{botBody(b)}</div>
          ))}
          {panel("the tape", tapeBody())}
        </div>
      </div>
    );
  }

  // ── Desktop: the windowed terminal ────────────────────────────
  return (
    <div className="flex h-full flex-col bg-page">
      <MenuBar facts={facts} />
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{
          backgroundImage:
            "linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          backgroundPosition: "-1px -1px",
        }}
      >
        {/* Dock — panel launchers + every bot */}
        <div className="absolute right-3 top-3 z-[1] flex max-h-[calc(100%-24px)] w-44 flex-col overflow-hidden border border-hairline bg-card/95">
          <div className="th border-b border-hairline px-2.5 py-1.5 text-brand">panels</div>
          <ul className="border-b border-hairline">
            {PANELS.map((p) => (
              <li key={p.id}>
                <button onClick={() => open(p.id)} className="th w-full border-b border-hairline/40 px-2.5 py-1 text-left normal-case tracking-normal text-ink2 transition-colors last:border-0 hover:bg-brand/[0.06] hover:text-brand">
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="th border-b border-hairline px-2.5 py-1.5 text-brand">bots</div>
          <ul className="overflow-auto">
            {ranked.map((b) => (
              <li key={b.slug}>
                <button onClick={() => open(`bot:${b.slug}`)} className="flex w-full items-center gap-2 border-b border-hairline/50 px-2.5 py-1.5 text-left transition-colors hover:bg-brand/[0.06]">
                  <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ background: b.color }} />
                  <span className="num truncate text-[12px] text-ink">{b.name}</span>
                  <span className={`num ml-auto text-[11px] ${cls(b.d7)}`}>{pct(b.d7)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {wins.filter((w) => !w.min).map((w) => {
          const s = winSpec(w.id);
          return (
            <div
              key={w.id}
              onPointerDown={() => focus(w.id)}
              className="absolute flex flex-col border border-hairline-2 bg-card shadow-[4px_4px_0_0_rgba(0,0,0,0.5)]"
              style={{ left: w.x, top: w.y, zIndex: w.z, width: s.w, maxHeight: "84%", height: s.h || undefined }}
            >
              {titleBar(w, s.title, s.swatch)}
              <div className="min-h-0 flex-1 overflow-auto">{s.body}</div>
            </div>
          );
        })}
      </div>

      {/* Ticker — the tape crawling along the rail */}
      <div className="overflow-hidden border-t border-hairline bg-page-deep">
        {tape.length === 0 ? (
          <div className="th px-3 py-1 text-ink4">tape · awaiting the first fills</div>
        ) : (
          <div className="marquee py-1 text-[0.66rem]">
            {[...tape, ...tape].map((f, i) => (
              <span key={i} className="mx-3 inline-flex items-center gap-1.5">
                <span className="text-ink3">{f.name}</span>
                <span className={f.side === "buy" ? "text-good" : "text-bad"}>{f.side === "buy" ? "▲" : "▼"}</span>
                <span className="text-ink">{f.symbol}</span>
                <span className="num text-ink3">{f.sol.toFixed(2)}◎</span>
                <span className="text-ink4">·</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Taskbar */}
      <div className="flex items-center gap-1 border-t border-hairline-2 bg-page-deep px-2 py-1">
        <span className="th mr-1 text-brand">◆</span>
        {wins.map((w) => (
          <button
            key={w.id}
            onClick={() => (w.min ? focus(w.id) : minimize(w.id))}
            className={`th max-w-[9rem] truncate border px-2 py-1 normal-case tracking-normal transition-colors ${w.min ? "border-hairline text-ink3 hover:text-ink" : "border-hairline-2 bg-card2 text-ink2"}`}
          >
            {panelTitle(w.id)}
          </button>
        ))}
        <span className="th ml-auto hidden lg:inline">click a bot · drag titlebars · real money · on-chain</span>
      </div>
    </div>
  );
}
