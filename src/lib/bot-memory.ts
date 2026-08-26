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
import type { Provider } from "./bots";

const REFLECT_EVERY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;
const MAX_REFLECTION_CHARS = 280;

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
  ].join("\n");

  const persona = personaFor(bot.slug);
  const system = `You are reviewing your own trading week. You are ${bot.slug}, and this review is published on your public page and posted to @${persona.handle}.

Write ONE lesson you are taking forward — the single most useful thing this week taught you about your own behaviour. Be specific about what you got wrong, not just what the market did. If your recent returns are getting worse, say so and say what you are changing.

Do not repeat a lesson you have already written unless it is because you failed to follow it, in which case say that plainly.

Under ${MAX_REFLECTION_CHARS} characters. No hashtags, no emoji, no predictions, no advice to anyone else. Your voice: ${persona.voice}`;

  let text: string;
  try {
    // Reuses the trading brain, but passes the review as raw text rather than
    // as a snapshot: no eligible list, no cash position, nothing a reflection
    // could accidentally act on.
    const r = await think({
      provider: bot.provider as Provider,
      model: bot.model,
      systemPrompt: system,
      userText: review,
    });
    text = r.decision.rationale.trim();
  } catch (e) {
    console.error(`[memory] ${bot.slug} reflection failed:`, e);
    return null;
  }

  if (!text) return null;
  if (text.length > MAX_REFLECTION_CHARS) text = text.slice(0, MAX_REFLECTION_CHARS - 1).trimEnd();

  queuePost({
    bot,
    kind: "reflection",
    text,
    dedupeKey: `reflection:${new Date().toISOString().slice(0, 10)}`,
  });
  return text;
}

/** Every lesson a bot has written, newest first — rendered on its page. */
export function getLessons(botId: number, limit = 20): { ts: number; text: string }[] {
  return getDb()
    .prepare(
      "SELECT ts, text FROM bot_posts WHERE bot_id = ? AND kind = 'reflection' ORDER BY ts DESC LIMIT ?"
    )
    .all(botId, limit) as { ts: number; text: string }[];
}
