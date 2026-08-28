import { ImageResponse } from "next/og";
import { getBot, getBotReturn } from "@/lib/bot-nav";
import { personaFor } from "@/lib/bot-persona";
import { botTradeStats, sparkline } from "@/lib/bot-stats";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";

export const runtime = "nodejs";
export const alt = "Automata bot card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const DAY = 24 * 3600_000;

// Persona colors are CSS variables for the DOM; satori needs literals. Same
// values as globals.css :root.
const CSS_COLORS: Record<string, string> = {
  "var(--s1)": "#6ba3ff",
  "var(--s2)": "#ff7a8a",
  "var(--s3)": "#4ecdc4",
  "var(--s4)": "#f7c04a",
  "var(--s5)": "#b98cff",
  "var(--s6)": "#4fe0a0",
  "var(--s7)": "#59b7ff",
  "var(--s8)": "#ff9d5c",
  "var(--gold)": "#f0c65a",
  "var(--ink2)": "#bdb6cf",
  "var(--ink3)": "#8a839e",
};
const hex = (cssColor: string | undefined) => CSS_COLORS[cssColor ?? ""] ?? "#f0c65a";

/**
 * The share card. Every link posted to X becomes a small billboard: name in
 * the bot's color, the 7-day number huge, win rate and realized PnL as
 * receipts, the real sparkline. No screenshots of marketing — screenshots of
 * the record.
 */
export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bot = getBot(slug);
  const persona = bot ? personaFor(bot.slug) : null;

  const d7 = bot ? getBotReturn(bot.id, 7 * DAY) : null;
  const stats = bot ? botTradeStats(bot.id) : null;
  const spark = bot ? sparkline(bot.id, 7, 60) : [];

  const up = d7 !== null && d7 >= 0;
  const pct = d7 === null ? "—" : `${up ? "+" : ""}${(d7 * 100).toFixed(1)}%`;

  // The 7-day curve as bars — satori renders flex divs reliably, raw svg less so.
  let bars: number[] = [];
  if (spark.length >= 2) {
    const min = Math.min(...spark);
    const max = Math.max(...spark);
    const span = Math.max(max - min, 1e-9);
    bars = spark.slice(-40).map((v) => 8 + ((v - min) / span) * 112);
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#100e17",
          color: "#f6f4fb",
          padding: 64,
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div
              style={{
                width: 28,
                height: 28,
                background: hex(persona?.color),
                borderRadius: 6,
              }}
            />
            <div style={{ fontSize: 56, fontWeight: 700, color: hex(persona?.color) }}>
              {bot?.name ?? "Automata"}
            </div>
          </div>
          <div style={{ fontSize: 28, color: "#8a839e", letterSpacing: 4 }}>◆ AUTOMATA</div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 24, color: "#8a839e", textTransform: "uppercase", letterSpacing: 3 }}>
              7-day trading return
            </div>
            <div style={{ fontSize: 120, fontWeight: 700, color: d7 === null ? "#8a839e" : up ? "#3ddc84" : "#ff5c6c" }}>
              {pct}
            </div>
            <div style={{ display: "flex", gap: 40, fontSize: 26, color: "#bdb6cf" }}>
              <div style={{ display: "flex" }}>
                win rate{" "}
                {stats?.winRate == null ? "—" : ` ${(stats.winRate * 100).toFixed(0)}%`}
              </div>
              <div style={{ display: "flex" }}>
                realized{" "}
                {stats && stats.closedTrades > 0
                  ? ` ${stats.realizedLamports >= 0 ? "+" : ""}${(stats.realizedLamports / LAMPORTS_PER_SOL).toFixed(2)} SOL`
                  : " —"}
              </div>
            </div>
          </div>
          {bars.length > 0 && (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 130 }}>
              {bars.map((h, i) => (
                <div
                  key={i}
                  style={{
                    width: 8,
                    height: h,
                    background: up ? "#3ddc84" : "#ff5c6c",
                    opacity: 0.4 + (i / bars.length) * 0.6,
                    borderRadius: 2,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div style={{ fontSize: 22, color: "#8a839e" }}>
          real wallets · real swaps · no simulated data · beating the random picker is the bar
        </div>
      </div>
    ),
    size
  );
}
