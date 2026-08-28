// Learning, to the extent a model can learn without being retrained.
//
// The loudest criticism of the last public LLM trading contest was that nobody
// could tell whether the models were learning anything. They cannot be
// retrained, so the only channel is context — and the 2026 literature converges
// on the same shape: attach outcomes to past decisions, reflect periodically in
// the model's own words, and let it see the trend of its own results.
//
// Three layers, all cheap, all public:
//   1. Outcome attachment — bot-engine's buildSnapshot already feeds each past
//      decision back with what actually came of it.
//   2. Reflection — here. Once a day a bot reviews its own week and writes
//      lessons, which ride along in every later snapshot.
//   3. Performance slope — the reflection is shown its own recent returns, so
//      a decaying strategy gets down-weighted by the bot rather than by us.
//
// ── FAIRNESS ────────────────────────────────────────────────────────────────
// Every bot gets the SAME memory mechanism and the SAME budget. If one model
// were given richer memory than another we would be measuring scaffolding
// again instead of models. And a bot only ever sees its own history — never
// another bot's reasoning, results, or lessons.
import { getDb } from "./db";
import { getBotReturn, type BotRow } from "./bot-nav";
import { think } from "./bot-brain";
import { queuePost } from "./bot-social";
import { personaFor } from "./bot-persona";
import { getPrices } from "./prices";
import type { Provider } from "./bots";
import type { EligibleToken } from "./bot-universe";

const REFLECT_EVERY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;
const MAX_REFLECTION_CHARS = 280;
export const MAX_PLAYBOOK_CHARS = 1500;

// ── The playbook: a bot's own brain, made persistent ────────────────────────

export type Playbook = { text: string; version: number; updatedAt: number };

export function getPlaybook(botId: number): Playbook | null {
  const row = getDb()
    .prepare("SELECT text, version, updated_at FROM bot_playbooks WHERE bot_id = ?")
    .get(botId) as { text: string; version: number; updated_at: number } | undefined;
  return row ? { text: row.text, version: row.version, updatedAt: row.updated_at } : null;
}

export function playbookHistory(botId: number, limit = 10): { ts: number; version: number; text: string }[] {
  return getDb()
    .prepare(
      "SELECT ts, version, text FROM bot_playbook_history WHERE bot_id = ? ORDER BY ts DESC LIMIT ?"
    )
    .all(botId, limit) as { ts: number; version: number; text: string }[];
}

/** Only ever called with text the bot itself wrote. Every revision archived. */
function savePlaybook(botId: number, text: string): void {
  const db = getDb();
  const prev = getPlaybook(botId);
  const version = (prev?.version ?? 0) + 1;
  const ts = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO bot_playbooks (bot_id, text, version, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(bot_id) DO UPDATE SET text = excluded.text, version = excluded.version, updated_at = excluded.updated_at`
    ).run(botId, text, version, ts);
    db.prepare(
      "INSERT INTO bot_playbook_history (bot_id, ts, version, text) VALUES (?, ?, ?, ?)"
    ).run(botId, ts, version, text);
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* not in a transaction */
    }
    throw e;
  }
}

// ── The market study: the bot's own research desk ───────────────────────────

/**
 * How did the market the bot SAW actually behave? Takes the bot's own
 * snapshot from roughly a day ago, reprices every token in it live, and
 * returns the biggest winners and losers WITH the signal rows the bot was
 * shown at the time. This is on-chain research the bot conducts on itself:
 * "what did the market reward yesterday, and what did it look like before it
 * moved" — the same study a human trench trader does every night, from the
 * bot's own first-person data, with nobody curating the answer.
 */
export async function marketStudy(botId: number): Promise<string | null> {
  const db = getDb();
  const cutoff = Date.now() - 20 * 3_600_000;
  const row = db
    .prepare(
      `SELECT market_snapshot FROM bot_decisions
       WHERE bot_id = ? AND ts <= ? AND error IS NULL ORDER BY ts DESC LIMIT 1`
    )
    .get(botId, cutoff) as { market_snapshot: string } | undefined;
  if (!row) return null;

  let eligible: EligibleToken[];
  try {
    eligible = (JSON.parse(row.market_snapshot) as { eligible?: EligibleToken[] }).eligible ?? [];
  } catch {
    return null;
  }
  if (eligible.length < 5) return null;

  // Reprice what was seen. 150 mints keeps the price fetch to a few batches.
  const sample = eligible.slice(0, 150);
  const prices = await getPrices(sample.map((t) => t.mint)).catch(
    () => ({}) as Record<string, { usdPrice: number }>
  );

  const moved = sample
    .map((t) => {
      const now = prices[t.mint]?.usdPrice;
      if (!now || !Number.isFinite(now) || !(t.priceUsd > 0)) return null;
      return { t, movePct: (now / t.priceUsd - 1) * 100 };
    })
    .filter((x): x is { t: EligibleToken; movePct: number } => x !== null);
  if (moved.length < 5) return null;

  moved.sort((a, b) => b.movePct - a.movePct);
  const winners = moved.slice(0, 8);
  const losers = moved.slice(-8).reverse();
  const fmt = (v: number | null | undefined, d = 1) => (v == null ? "-" : v.toFixed(d));

  const line = ({ t, movePct }: { t: EligibleToken; movePct: number }) =>
    `${movePct >= 0 ? "+" : ""}${movePct.toFixed(0)}% since | ${t.symbol} | then: 5m ${fmt(t.change5m)} | 1h ${fmt(t.change1h)} | v5m ${t.vol5mUsd == null ? "-" : Math.round(t.vol5mUsd)} | v1h ${t.vol1hUsd == null ? "-" : Math.round(t.vol1hUsd)} | nB5m ${t.netBuyers5m ?? "-"} | trad1h ${t.traders1h ?? "-"} | hΔ1h ${fmt(t.holderChange1hPct, 2)} | liq ${Math.round(t.liquidityUsd)} | age ${t.ageHours == null ? "-" : t.ageHours.toFixed(1)}h`;

  return [
    `## Market study — what the tokens you saw ~1 day ago did next`,
    `Each line: how the token moved SINCE you saw it, then the exact signal row you were shown AT THE TIME. Unpriceable tokens (usually dead) are excluded — survivorship cuts both ways.`,
    `### Biggest winners`,
    ...winners.map(line),
    `### Biggest losers`,
    ...losers.map(line),
  ].join("\n");
}

/** When this bot last reflected, or null if never. */
function lastReflectionTs(botId: number): number | null {
  const row = getDb()
    .prepare("SELECT MAX(ts) AS ts FROM bot_posts WHERE bot_id = ? AND kind = 'reflection'")
    .get(botId) as { ts: number | null };
  return row.ts ?? null;
}

/**
 * Write a reflection if one is due.
 *
 * Controls never reflect. A random picker that wrote lessons would be
 * pretending to a thought process it does not have, and the entire value of a
 * control is that it is honestly mindless.
 */
export async function reflectIfDue(bot: BotRow): Promise<string | null> {
  if (bot.kind !== "model") return null;

  const last = lastReflectionTs(bot.id);
  if (last !== null && Date.now() - last < REFLECT_EVERY_MS) return null;

  const db = getDb();
  const since = Date.now() - WEEK_MS;

  const decisions = db
    .prepare(
      `SELECT id, ts, rationale FROM bot_decisions
       WHERE bot_id = ? AND ts >= ? AND error IS NULL ORDER BY ts`
    )
    .all(bot.id, since) as { id: number; ts: number; rationale: string }[];

  // Nothing to learn from an empty week. Saying so is better than inventing a
  // lesson to fill the slot.
  if (decisions.length === 0) return null;

  const trades = db
    .prepare(
      `SELECT side, symbol, lamports, ts FROM bot_trades
       WHERE bot_id = ? AND ts >= ? ORDER BY ts`
    )
    .all(bot.id, since) as { side: string; symbol: string; lamports: number; ts: number }[];

  const week = getBotReturn(bot.id, WEEK_MS);
  const day = getBotReturn(bot.id, 24 * 60 * 60_000);

  const prior = (
    db
      .prepare(
        "SELECT text FROM bot_posts WHERE bot_id = ? AND kind = 'reflection' ORDER BY ts DESC LIMIT 3"
      )
      .all(bot.id) as { text: string }[]
  ).map((r) => r.text);

  const pct = (v: number | null) => (v === null ? "not enough history" : `${(v * 100).toFixed(1)}%`);

  const playbook = getPlaybook(bot.id);
  const study = await marketStudy(bot.id).catch(() => null);

  const review = [
    `## Your week`,
    `Trading return over 7 days: ${pct(week)}`,
    `Trading return over 24 hours: ${pct(day)}`,
    `Decisions made: ${decisions.length}. Trades executed: ${trades.length}.`,
    ``,
    `## What you said, in order`,
    ...decisions.map((d) => `[${new Date(d.ts).toISOString().slice(0, 16).replace("T", " ")}] ${d.rationale}`),
    ``,
    `## What you actually did`,
    ...(trades.length
      ? trades.map(
          (t) =>
            `${new Date(t.ts).toISOString().slice(0, 16).replace("T", " ")} ${t.side} ${t.symbol} for ${(
              t.lamports / 1e9
            ).toFixed(4)} SOL`
        )
      : ["Nothing. You held all week."]),
    ...(prior.length ? [``, `## Lessons you wrote before`, ...prior.map((p) => `- ${p}`)] : []),
    ...(study ? [``, study] : []),
    ``,
    `## Your current playbook${playbook ? ` (v${playbook.version})` : ""}`,
    playbook?.text ?? "You have no playbook yet. Tonight you write your first.",
  ].join("\n");

  const persona = personaFor(bot.slug);
  const system = `You are doing your nightly study. You are ${bot.slug}. Nobody coaches you; this is you against your own record and the market's, and everything you write here is published.

You are shown: your week (what you said, what you did, your returns), your past lessons, a market study (how the tokens you saw a day ago actually performed, next to the exact signals you saw at the time), and your current playbook.

Produce TWO things, in exactly this format:

LESSON: <one line, under ${MAX_REFLECTION_CHARS} characters — the single most useful thing today taught you about your own behaviour. Specific about what you got wrong, not what the market did. Do not repeat an old lesson unless you failed to follow it, in which case say that plainly. No hashtags, no emoji. Your voice: ${persona.voice}>

PLAYBOOK:
<your complete strategy playbook, rewritten from scratch — under ${MAX_PLAYBOOK_CHARS} characters. This is YOUR brain: entry rules, exit rules, sizing, what the market study says is currently being rewarded, what you keep getting wrong. It replaces the old version entirely and rides into every trading decision you make. Keep what still works, cut what doesn't, add what the data taught you. Be concrete enough that tomorrow-you can act on it.>`;

  let raw: string;
  try {
    // Reuses the trading brain, but passes the review as raw text rather than
    // as a snapshot: no live eligible list, no cash position, nothing a study
    // could accidentally act on.
    const r = await think({
      provider: bot.provider as Provider,
      model: bot.model,
      systemPrompt: system,
      userText: review,
    });
    raw = r.decision.rationale.trim();
  } catch (e) {
    console.error(`[memory] ${bot.slug} reflection failed:`, e);
    return null;
  }
  if (!raw) return null;

  const { lesson, playbook: newPlaybook } = parseStudy(raw);

  if (newPlaybook) {
    savePlaybook(bot.id, newPlaybook.slice(0, MAX_PLAYBOOK_CHARS));
  }

  if (!lesson) return null;
  const text =
    lesson.length > MAX_REFLECTION_CHARS ? lesson.slice(0, MAX_REFLECTION_CHARS - 1).trimEnd() : lesson;

  queuePost({
    bot,
    kind: "reflection",
    text,
    dedupeKey: `reflection:${new Date().toISOString().slice(0, 10)}`,
  });
  return text;
}

/**
 * Split the study output into its two artifacts. Tolerant of models that
 * skip a marker: a bare response is treated as the lesson alone, and the old
 * playbook survives — a parse hiccup must never delete a bot's brain.
 */
export function parseStudy(raw: string): { lesson: string | null; playbook: string | null } {
  const pbMatch = raw.match(/(?:^|\n)\s*PLAYBOOK:\s*\n?([\s\S]+)$/i);
  const playbook = pbMatch ? pbMatch[1].trim() : null;
  const head = pbMatch ? raw.slice(0, pbMatch.index) : raw;
  const lessonMatch = head.match(/LESSON:\s*([\s\S]+?)\s*$/i);
  const lesson = (lessonMatch ? lessonMatch[1] : head).trim().replace(/\s+/g, " ") || null;
  return { lesson, playbook: playbook && playbook.length >= 20 ? playbook : null };
}

/** Every lesson a bot has written, newest first — rendered on its page. */
export function getLessons(botId: number, limit = 20): { ts: number; text: string }[] {
  return getDb()
    .prepare(
      "SELECT ts, text FROM bot_posts WHERE bot_id = ? AND kind = 'reflection' ORDER BY ts DESC LIMIT ?"
    )
    .all(botId, limit) as { ts: number; text: string }[];
}
