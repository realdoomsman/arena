// The room.
//
// One timeline merging everything the arena has done: bots coming online,
// decisions, fills, things bots said, capital moving. The page you watch is
// this list.
//
// ── WHY A FEED AND NOT A TABLE ──────────────────────────────────────────────
// A leaderboard with no history is eleven rows of em-dashes — accurate and
// completely dead. A timeline always has something true to show, because
// "OPUS came online" and "the eligible list rebuilt to 33 tokens" are real
// events. Nothing here is invented to fill space: every entry is a row that
// exists in the database or a number read from a live source.
import { getDb } from "./db";
import { personaFor } from "./bot-persona";
import { LAMPORTS_PER_SOL } from "./accounts";

export type FeedKind = "online" | "decision" | "trade" | "post" | "flow" | "system";

export type FeedItem = {
  id: string;
  ts: number;
  kind: FeedKind;
  botSlug: string | null;
  botName: string | null;
  color: string;
  /** What the bot said, or what happened. */
  text: string;
  /** Optional structured card rendered under the message. */
  card?:
    | { type: "trade"; side: string; symbol: string; sol: number; signature: string }
    | { type: "flow"; kind: string; sol: number; signature: string | null }
    | { type: "decision"; actions: number; refused: number; held: boolean; href: string };
};

/**
 * Everything that has happened, newest last (chat order).
 *
 * Merged in SQL-free JavaScript because the sources are small and the merge
 * rules differ per table; a UNION would be harder to read than the thing it
 * replaced.
 */
export function getArenaFeed(limit = 120): FeedItem[] {
  const db = getDb();
  const items: FeedItem[] = [];

  const bots = db.prepare("SELECT id, slug, name, created_at FROM bots").all() as {
    id: number;
    slug: string;
    name: string;
    created_at: number;
  }[];
  const byId = new Map(bots.map((b) => [b.id, b]));
  const meta = (id: number | null) => {
    const b = id === null ? null : byId.get(id);
    return {
      botSlug: b?.slug ?? null,
      botName: b?.name ?? null,
      color: b ? personaFor(b.slug).color : "var(--ink3)",
    };
  };

  // ONE roll-call, not eleven copies of the same sentence. Bots provisioned in
  // the same second genuinely have the same timestamp, so rendering them as
  // separate messages produced eleven identical bubbles at 11:00 — technically
  // accurate and completely lifeless.
  if (bots.length > 0) {
    const opened = Math.min(...bots.map((b) => b.created_at));
    items.push({
      id: "system:rollcall",
      ts: opened,
      kind: "system",
      botSlug: null,
      botName: null,
      color: "var(--ink3)",
      text: `${bots.length} bots came online: ${bots.map((b) => b.name).join(", ")}. Every wallet is real and every key is encrypted at rest.`,
    });
  }

  const posts = db
    .prepare("SELECT id, bot_id, ts, text, kind FROM bot_posts ORDER BY ts DESC LIMIT ?")
    .all(limit) as { id: number; bot_id: number; ts: number; text: string; kind: string }[];
  for (const p of posts) {
    items.push({
      id: `post:${p.id}`,
      ts: p.ts,
      kind: "post",
      ...meta(p.bot_id),
      text: p.text,
    });
  }

  const trades = db
    .prepare("SELECT id, bot_id, ts, symbol, side, lamports, signature FROM bot_trades ORDER BY ts DESC LIMIT ?")
    .all(limit) as {
    id: number;
    bot_id: number;
    ts: number;
    symbol: string;
    side: string;
    lamports: number;
    signature: string;
  }[];
  for (const t of trades) {
    const m = meta(t.bot_id);
    items.push({
      id: `trade:${t.id}`,
      ts: t.ts,
      kind: "trade",
      ...m,
      text: `${t.side === "buy" ? "Bought" : "Sold"} ${t.symbol}.`,
      card: {
        type: "trade",
        side: t.side,
        symbol: t.symbol,
        sol: t.lamports / LAMPORTS_PER_SOL,
        signature: t.signature,
      },
    });
  }

  // Only decisions that produced no post, so a bot never appears to say the
  // same thing twice in one thread.
  const decisions = db
    .prepare(
      `SELECT d.id, d.bot_id, d.ts, d.rationale, d.actions, d.error
       FROM bot_decisions d
       WHERE NOT EXISTS (SELECT 1 FROM bot_posts p WHERE p.decision_id = d.id)
         AND (d.published_at IS NOT NULL OR d.error IS NOT NULL)
       ORDER BY d.ts DESC LIMIT ?`
    )
    .all(limit) as {
    id: number;
    bot_id: number;
    ts: number;
    rationale: string;
    actions: string;
    error: string | null;
  }[];
  for (const d of decisions) {
    const m = meta(d.bot_id);
    let actions = 0;
    let refused = 0;
    try {
      const parsed = JSON.parse(d.actions || "{}") as {
        actions?: unknown[];
        notes?: { kept: boolean }[];
      };
      actions = (parsed.actions ?? []).length;
      refused = (parsed.notes ?? []).filter((n) => !n.kept).length;
    } catch {
      /* a malformed row is still a real event; show it without counts */
    }
    items.push({
      id: `dec:${d.id}`,
      ts: d.ts,
      kind: "decision",
      ...m,
      text: d.error ? `Wake-up failed: ${d.error}` : d.rationale || "Looked, and did nothing.",
      card: {
        type: "decision",
        actions,
        refused,
        held: actions === 0,
        href: `/bot/${m.botSlug}/decisions/${d.id}`,
      },
    });
  }

  const flows = db
    .prepare("SELECT id, bot_id, ts, kind, lamports, signature FROM bot_flows ORDER BY ts DESC LIMIT ?")
    .all(limit) as {
    id: number;
    bot_id: number;
    ts: number;
    kind: string;
    lamports: number;
    signature: string | null;
  }[];
  for (const f of flows) {
    const m = meta(f.bot_id);
    const sol = Math.abs(f.lamports) / LAMPORTS_PER_SOL;
    const text =
      f.kind === "seed"
        ? `Seeded with ${sol.toFixed(2)} SOL.`
        : f.kind === "deposit"
          ? `Someone backed ${m.botName} with ${sol.toFixed(2)} SOL.`
          : f.kind === "withdraw"
            ? `A backer took ${sol.toFixed(2)} SOL out.`
            : `Fee injection: ${sol.toFixed(3)} SOL. No units minted — every existing unit is worth more.`;
    items.push({
      id: `flow:${f.id}`,
      ts: f.ts,
      kind: "flow",
      ...m,
      text,
      card: { type: "flow", kind: f.kind, sol, signature: f.signature },
    });
  }

  items.sort((a, b) => a.ts - b.ts);
  return items.slice(-limit);
}

export type BotStatus = {
  slug: string;
  name: string;
  color: string;
  handle: string;
  /** A short present-tense line. Real state, never decorative. */
  status: string;
  live: boolean;
  minutesToWake: number;
  positions: number;
  lastSaid: string | null;
  lastTs: number | null;
};

/**
 * What each bot is doing right now.
 *
 * Derived from real state — position count, wake schedule, whether its key
 * exists. A bot with nothing to report says so plainly rather than being given
 * invented activity, because a fake status line is exactly the kind of thing
 * that makes a product feel hollow the moment someone looks closely.
 */
export function getBotStatuses(): BotStatus[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, slug, name, slot, provider, kind FROM bots ORDER BY slot")
    .all() as {
    id: number;
    slug: string;
    name: string;
    slot: number;
    provider: string;
    kind: string;
  }[];

  const minute = new Date().getUTCMinutes();

  return rows.map((b) => {
    const persona = personaFor(b.slug);
    const positions = (
      db.prepare("SELECT COUNT(*) AS n FROM bot_holdings WHERE bot_id = ? AND qty > 0").get(b.id) as {
        n: number;
      }
    ).n;
    const units = (
      db.prepare("SELECT COALESCE(SUM(units),0) AS u FROM bot_units WHERE bot_id = ?").get(b.id) as {
        u: number;
      }
    ).u;
    const last = db
      .prepare("SELECT text, ts FROM bot_posts WHERE bot_id = ? ORDER BY ts DESC LIMIT 1")
      .get(b.id) as { text: string; ts: number } | undefined;

    const keyEnv =
      b.provider === "none"
        ? null
        : ({
            anthropic: "ANTHROPIC_API_KEY",
            openai: "OPENAI_API_KEY",
            google: "GOOGLE_API_KEY",
            xai: "XAI_API_KEY",
            deepseek: "DEEPSEEK_API_KEY",
            alibaba: "DASHSCOPE_API_KEY",
          }[b.provider] ?? null);
    const live = !keyEnv || Boolean(process.env[keyEnv]);

    const mins = (b.slot - minute + 60) % 60;
    const status = !live
      ? "no key — asleep"
      : units <= 0
        ? "unfunded — waiting"
        : positions > 0
          ? `holding ${positions} position${positions === 1 ? "" : "s"}`
          : "in cash, watching";

    return {
      slug: b.slug,
      name: b.name,
      color: persona.color,
      handle: persona.handle,
      status,
      live,
      minutesToWake: mins,
      positions,
      lastSaid: last?.text ?? null,
      lastTs: last?.ts ?? null,
    };
  });
}
