// One bot, one hour, one decision.
//
// This is the only place a bot's money moves. Models and controls come through
// the same path so any performance difference is judgement rather than
// plumbing — a control executed on a cheaper path would not be a valid
// baseline.
//
// ── MONEY-SAFETY RULES INHERITED FROM PRODUCTION ────────────────────────────
// Legs execute ONE AT A TIME and each is committed the moment it confirms. A
// later failure can therefore never erase or duplicate an earlier fill. Every
// transaction is confirmed, not merely accepted by the RPC — an accepted
// transaction that never lands would otherwise become a phantom holding in
// the ledger while the chain disagrees.
import { getDb } from "./db";
import { getBot, getBotNav, writeSnapshot, type BotRow, type BotNav } from "./bot-nav";
import { buildEligibleList, checkSafety, type EligibleToken } from "./bot-universe";
import { validateDecision, type Decision, type MarketSnapshot, type ValidationNote } from "./bot-decision";
import { monkeyDecision, indexDecision, diamondDecision } from "./bot-controls";
import { think } from "./bot-brain";
import { SHARED_SYSTEM_PROMPT, type Provider } from "./bots";
import { quoteBasketLegs, quoteExitLegs, buildSwapTransactions, SwapError } from "./swap";
import { signSendConfirmOneWith, getTokenBalanceRaw, getTransactionFill, LAMPORTS_PER_SOL } from "./accounts";
import { getPrices } from "./prices";
import { invalidateWallet, mintSymbol, SOL_MINT } from "./wallets";
import { queuePost } from "./bot-social";
import { enterCritical, exitCritical, isDraining } from "./inflight";

export class EngineError extends Error {}

const SLIPPAGE_BPS = Number(process.env.BOT_SLIPPAGE_BPS ?? 150);

export type WakeResult = {
  botId: number;
  slug: string;
  decisionId: number | null;
  rationale: string;
  executed: number;
  refused: number;
  notes: ValidationNote[];
  error: string | null;
};

/** Build the exact input a bot sees. Deterministic and stored verbatim. */
export async function buildSnapshot(bot: BotRow, nav: BotNav): Promise<MarketSnapshot> {
  const db = getDb();
  const eligible = await buildEligibleList();

  const rows = db
    .prepare("SELECT mint, qty, cost_lamports, opened_at FROM bot_holdings WHERE bot_id = ? AND qty > 0")
    .all(bot.id) as { mint: string; qty: number; cost_lamports: number; opened_at: number }[];

  const positions: MarketSnapshot["positions"] = [];
  for (const r of rows) {
    const held = nav.holdings.find((h) => h.mint === r.mint);
    const valueLamports = held?.lamports ?? 0;
    positions.push({
      mint: r.mint,
      symbol: mintSymbol(r.mint),
      qty: r.qty,
      valueLamports,
      costLamports: r.cost_lamports,
      pnlPct: r.cost_lamports > 0 ? (valueLamports / r.cost_lamports - 1) * 100 : 0,
      heldHours: r.opened_at ? (Date.now() - r.opened_at) / 3_600_000 : 0,
    });
  }

  // A bot only ever sees its OWN history. Showing one bot another's reasoning
  // would turn eleven independent experiments into one correlated one.
  const recent = (
    db
      .prepare(
        "SELECT id, ts, rationale, actions FROM bot_decisions WHERE bot_id = ? AND error IS NULL ORDER BY ts DESC LIMIT 8"
      )
      .all(bot.id) as { id: number; ts: number; rationale: string; actions: string }[]
  )
    .reverse()
    .map((d) => ({
      ts: d.ts,
      rationale: d.rationale,
      actions: JSON.parse(d.actions) as MarketSnapshot["recent"][number]["actions"],
      outcome: outcomeFor(d.id),
    }));

  const lessons = (
    db
      .prepare("SELECT text FROM bot_posts WHERE bot_id = ? AND kind = 'reflection' ORDER BY ts DESC LIMIT 3")
      .all(bot.id) as { text: string }[]
  ).map((r) => r.text);

  const { notesForSnapshot } = await import("./bot-notes");

  return {
    ts: Date.now(),
    navLamports: nav.navLamports,
    idleLamports: nav.solLamports,
    positions,
    eligible,
    recent,
    lessons,
    backerNotes: notesForSnapshot(bot.id),
  };
}

/** What actually came of a past decision — the outcome-attachment learning loop. */
function outcomeFor(decisionId: number): string | null {
  const trades = getDb()
    .prepare("SELECT side, symbol, lamports FROM bot_trades WHERE decision_id = ?")
    .all(decisionId) as { side: string; symbol: string; lamports: number }[];
  if (trades.length === 0) return null;
  return trades
    .map((t) => `${t.side} ${t.symbol} for ${(t.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`)
    .join("; ");
}

/** Ask the bot what it wants to do. Controls think in code; models think remotely. */
async function decide(
  bot: BotRow,
  snap: MarketSnapshot
): Promise<{ decision: Decision; tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number }> {
  const blank = { tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0 };

  if (bot.kind === "control") {
    switch (bot.slug) {
      case "monkey":
        return { decision: monkeyDecision(snap), ...blank };
      case "index": {
        const last = getDb()
          .prepare("SELECT MAX(ts) AS ts FROM bot_trades WHERE bot_id = ?")
          .get(bot.id) as { ts: number | null };
        return { decision: indexDecision(snap, last.ts ?? null), ...blank };
      }
      case "diamond": {
        const n = getDb()
          .prepare("SELECT COUNT(*) AS n FROM bot_trades WHERE bot_id = ?")
          .get(bot.id) as { n: number };
        return { decision: diamondDecision(snap, n.n > 0), ...blank };
      }
      default:
        throw new EngineError(`unknown control "${bot.slug}"`);
    }
  }

  const r = await think({
    provider: bot.provider as Provider,
    model: bot.model,
    systemPrompt: bot.system_prompt || SHARED_SYSTEM_PROMPT,
    snapshot: snap,
  });
  return {
    decision: r.decision,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    costUsd: r.costUsd,
    latencyMs: r.latencyMs,
  };
}

/**
 * Run one wake-up end to end.
 *
 * Records a row whether or not anything traded, and whether or not the brain
 * errored. A hold is a decision; a failed wake-up is a fact about the bot's
 * record. Neither may vanish.
 */
export async function runWake(botIdOrSlug: number | string): Promise<WakeResult> {
  const bot = getBot(botIdOrSlug);
  if (!bot) throw new EngineError(`no such bot: ${botIdOrSlug}`);

  const db = getDb();
  const base: WakeResult = {
    botId: bot.id,
    slug: bot.slug,
    decisionId: null,
    rationale: "",
    executed: 0,
    refused: 0,
    notes: [],
    error: null,
  };

  const nav = await getBotNav(bot);
  if (!nav) {
    return { ...base, error: "NAV is unknown — a held position could not be priced" };
  }
  if (nav.navLamports <= 0) {
    return { ...base, error: "wallet is empty — nothing to trade" };
  }

  const snap = await buildSnapshot(bot, nav);

  let decision: Decision;
  let meta = { tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0 };
  try {
    const r = await decide(bot, snap);
    decision = r.decision;
    meta = { tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd, latencyMs: r.latencyMs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    recordDecision(bot, snap, { rationale: "", actions: [] }, [], meta, msg);
    return { ...base, error: msg };
  }

  const { actions, notes } = validateDecision(decision, {
    eligible: snap.eligible,
    navLamports: nav.navLamports,
    idleLamports: nav.solLamports,
    heldMints: new Set(snap.positions.map((p) => p.mint)),
    positions: snap.positions.map((p) => ({ mint: p.mint, valueLamports: p.valueLamports })),
  });

  const decisionId = recordDecision(bot, snap, { ...decision, actions }, notes, meta, null);

  let executed = 0;
  for (const action of actions) {
    // Shutdown began mid-wake: the legs already executed are committed, and
    // starting another would open a swap this process may not live to record.
    if (isDraining()) {
      notes.push({ action, kept: false, reason: "not started — the process is shutting down" });
      continue;
    }
    try {
      if (action.kind === "buy") {
        const token = snap.eligible[action.idx];
        // The safety gate, on the one token this bot actually chose. Cheap
        // enough to run per trade, which is what lets the universe be the
        // whole of Solana instead of whatever a rate limit could pre-clear.
        const safe = await checkSafety(token.mint);
        if (!safe.ok) {
          notes.push({ action, kept: false, reason: `refused on safety: ${safe.reason}` });
          continue;
        }
        await executeBuy(bot, decisionId, token, Math.floor(nav.navLamports * action.fraction));
      } else {
        await executeSell(bot, decisionId, action.mint, action.fraction);
      }
      executed++;
    } catch (e) {
      // One failed leg must not abort the rest: the earlier legs already
      // confirmed on-chain and are already committed to the ledger.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[engine] ${bot.slug} leg failed:`, msg);
      notes.push({ action, kept: false, reason: `execution failed: ${msg}` });
    }
  }

  // Re-price after trading so the curve point reflects the new book.
  invalidateWallet(bot.wallet);
  const after = await getBotNav(bot);
  if (after) writeSnapshot(bot, after);

  // Publish the decision only now — the swaps have landed, so nobody can read
  // the site and trade ahead of the bot. The notes are re-serialized in the
  // same statement: safety refusals and execution failures were appended after
  // the row was first written, and a refusal that never reaches the page is a
  // refusal the transparency claim cannot survive.
  db.prepare("UPDATE bot_decisions SET published_at = ?, actions = ? WHERE id = ?").run(
    Date.now(),
    JSON.stringify({ actions, notes }),
    decisionId
  );
  queueTradePost(bot, decisionId, decision.rationale, executed);

  return {
    ...base,
    decisionId,
    rationale: decision.rationale,
    executed,
    refused: notes.filter((n) => !n.kept).length,
    notes,
  };
}

function recordDecision(
  bot: BotRow,
  snap: MarketSnapshot,
  decision: Decision,
  notes: ValidationNote[],
  meta: { tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number },
  error: string | null
): number {
  const db = getDb();
  db.prepare(
    `INSERT INTO bot_decisions (bot_id, ts, market_snapshot, rationale, actions,
                                tokens_in, tokens_out, cost_usd, latency_ms, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bot.id,
    snap.ts,
    // The receipt that every bot saw identical data this hour.
    JSON.stringify(snap),
    decision.rationale,
    JSON.stringify({ actions: decision.actions, notes }),
    meta.tokensIn,
    meta.tokensOut,
    meta.costUsd,
    meta.latencyMs,
    error
  );
  return (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
}

async function executeBuy(
  bot: BotRow,
  decisionId: number,
  token: EligibleToken,
  lamports: number
): Promise<void> {
  const legs = await quoteBasketLegs(
    [{ mint: token.mint, symbol: token.symbol, weight: 1 }],
    lamports,
    SLIPPAGE_BPS
  );
  const txs = await buildSwapTransactions(legs, bot.wallet);
  if (txs.length !== 1) throw new SwapError("expected exactly one swap transaction");

  // CRITICAL SECTION. From here until the ledger commits, being killed leaves
  // a swap that is real on-chain and invisible in the books. Shutdown waits
  // for this to finish rather than exiting on top of it.
  enterCritical();
  try {
    const signature = await signSendConfirmOneWith(bot.encrypted_key, txs[0]);

    // Record what the wallet ACTUALLY received, not what Jupiter quoted —
    // slippage means those differ on every fill, and the receipt also carries
    // the mint's true decimals (a 9-decimal token recorded at the 6-decimal
    // default was off a thousandfold).
    let qty: number;
    const fill = await getTransactionFill(signature, bot.wallet).catch(() => null);
    const tokenFill = fill?.tokens.find((t) => t.mint === token.mint && t.rawDelta > BigInt(0));
    if (tokenFill) {
      qty = Number(tokenFill.rawDelta) / 10 ** tokenFill.decimals;
      rememberTokenMeta(token.mint, token.symbol, token.name, tokenFill.decimals);
    } else {
      const decimals = await mintDecimals(token.mint);
      qty = Number(legs[0].outAmount) / 10 ** decimals;
      console.warn(`[engine] could not read fill for ${signature} — recording the quoted amount`);
    }

    // Both rows or neither. The two statements are synchronous so only a hard
    // kill can land between them, but "a holding with no trade behind it" is
    // exactly the state that makes the ledger un-auditable later, and a
    // transaction costs nothing to add.
    const db = getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `INSERT INTO bot_holdings (bot_id, mint, qty, cost_lamports, opened_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(bot_id, mint) DO UPDATE SET
           qty = qty + excluded.qty,
           cost_lamports = cost_lamports + excluded.cost_lamports`
      ).run(bot.id, token.mint, qty, lamports, Date.now());

      db.prepare(
        `INSERT INTO bot_trades (bot_id, decision_id, ts, mint, symbol, side, lamports, qty, price, signature)
         VALUES (?, ?, ?, ?, ?, 'buy', ?, ?, ?, ?)`
      ).run(bot.id, decisionId, Date.now(), token.mint, token.symbol, lamports, qty, token.priceUsd, signature);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } finally {
    exitCritical();
  }
}

/**
 * Sell a fraction of one position.
 *
 * Exported because withdrawals need it too. `decisionId` is null when the sale
 * was forced by somebody leaving rather than chosen by the bot — the trade is
 * still recorded, but it must never appear in the bot's decision record as
 * though it had been its own idea.
 *
 * Returns the lamports actually realised, which is what a leaver is paid: they
 * bear the slippage on their own slice rather than the holders who stayed.
 */
export async function executeSell(
  bot: BotRow,
  decisionId: number | null,
  mint: string,
  fraction: number
): Promise<number> {
  const db = getDb();
  const row = db
    .prepare("SELECT qty, cost_lamports FROM bot_holdings WHERE bot_id = ? AND mint = ?")
    .get(bot.id, mint) as { qty: number; cost_lamports: number } | undefined;
  if (!row || row.qty <= 0) throw new EngineError("position not held");

  // Size from the CHAIN, not the ledger. If they disagree the chain is right,
  // and trying to sell more than exists would fail the whole leg.
  const onChain = await getTokenBalanceRaw(bot.wallet, mint);
  const rawAmount = (onChain * BigInt(Math.round(fraction * 10_000))) / BigInt(10_000);
  if (rawAmount <= BigInt(0)) throw new EngineError("nothing to sell on-chain");

  const symbol = mintSymbol(mint);
  const legs = await quoteExitLegs([{ mint, symbol, rawAmount: rawAmount.toString() }], SLIPPAGE_BPS);
  if (legs.length === 0) {
    // No route back to SOL right now (drained pool, delisted token). An
    // explicit refusal the caller can show — not txs[0]=undefined exploding
    // mid-withdrawal.
    throw new EngineError(`no route to exit ${symbol} right now — the pool may be drained`);
  }
  const txs = await buildSwapTransactions(legs, bot.wallet);
  if (txs.length === 0) throw new EngineError(`could not build an exit transaction for ${symbol}`);

  // Same critical window as a buy — a confirmed sale missing from the ledger
  // would leave the bot appearing to still hold something it has sold.
  enterCritical();
  try {
    return await commitSell(bot, decisionId, mint, symbol, fraction, legs, txs[0], row);
  } finally {
    exitCritical();
  }
}

async function commitSell(
  bot: BotRow,
  decisionId: number | null,
  mint: string,
  symbol: string,
  fraction: number,
  legs: Awaited<ReturnType<typeof quoteExitLegs>>,
  tx: string,
  row: { qty: number; cost_lamports: number }
): Promise<number> {
  const db = getDb();

  // Priced BEFORE the swap, deliberately. This used to sit between the
  // holdings write and the trades write, which parked a serialised Jupiter
  // call (350ms queue gap, 10s timeout, 1.2s retry on 429) inside the one
  // window where dying corrupts the books — the position gone from the ledger
  // and the sale never recorded. It is a display column; a price a second old
  // is fine, and nothing about it needs to be in the critical section.
  const priceUsd =
    (await getPrices([mint]).catch(() => ({}) as Record<string, { usdPrice: number }>))[mint]
      ?.usdPrice ?? 0;

  const signature = await signSendConfirmOneWith(bot.encrypted_key, tx);

  // The realised amount is what the wallet's SOL actually rose by (net of the
  // tx fee) — the quote is a promise, and paying a leaver the quote while the
  // pool filled worse would take the difference from whoever stayed.
  let proceeds = Number(legs[0].outAmount);
  const fill = await getTransactionFill(signature, bot.wallet).catch(() => null);
  if (fill && fill.solDelta > 0) {
    proceeds = fill.solDelta;
  } else if (!fill) {
    console.warn(`[engine] could not read fill for ${signature} — recording the quoted proceeds`);
  }
  const soldQty = row.qty * fraction;

  // A full exit zeroes the position outright rather than subtracting the
  // ledger's own figure from itself. The sale was SIZED from the chain
  // (getTokenBalanceRaw), so if the ledger had drifted, subtracting would
  // scale that drift forward instead of clearing it — and the comment above
  // the sizing call already claims the chain is authoritative. This makes the
  // write agree with that claim.
  const fullExit = fraction >= 0.999999;

  db.exec("BEGIN IMMEDIATE");
  try {
    if (fullExit) {
      db.prepare("DELETE FROM bot_holdings WHERE bot_id = ? AND mint = ?").run(bot.id, mint);
    } else {
      db.prepare(
        "UPDATE bot_holdings SET qty = ?, cost_lamports = ? WHERE bot_id = ? AND mint = ?"
      ).run(
        Math.max(0, row.qty - soldQty),
        Math.floor(row.cost_lamports * (1 - fraction)),
        bot.id,
        mint
      );
    }

    db.prepare(
      `INSERT INTO bot_trades (bot_id, decision_id, ts, mint, symbol, side, lamports, qty, price, signature)
       VALUES (?, ?, ?, ?, ?, 'sell', ?, ?, ?, ?)`
    ).run(bot.id, decisionId, Date.now(), mint, symbol, proceeds, soldQty, priceUsd, signature);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return proceeds;
}

async function mintDecimals(mint: string): Promise<number> {
  const row = getDb().prepare("SELECT decimals FROM token_meta WHERE mint = ?").get(mint) as
    | { decimals: number }
    | undefined;
  if (row) return row.decimals;
  // Jupiter's quote already accounted for decimals; 6 is the Solana default
  // and is only a display fallback for a mint we have never seen.
  return mint === SOL_MINT ? 9 : 6;
}

/** Persist what the chain told us about a mint, so decimals and symbols survive restarts. */
function rememberTokenMeta(mint: string, symbol: string, name: string, decimals: number): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO token_meta (mint, symbol, name, decimals) VALUES (?, ?, ?, ?)
         ON CONFLICT(mint) DO UPDATE SET decimals = excluded.decimals`
      )
      .run(mint, symbol || mint.slice(0, 8), name || symbol || mint.slice(0, 8), decimals);
  } catch (e) {
    console.error("[engine] token_meta write failed:", e);
  }
}

/**
 * Queue what the bot says about this hour.
 *
 * Controls speak for themselves in their own rationale; model bots get their
 * voice applied separately by the social pass, which runs after the trade has
 * already landed and therefore cannot influence it.
 */
function queueTradePost(bot: BotRow, decisionId: number, rationale: string, executed: number): void {
  if (!rationale) return;
  const text = rationale.length > 280 ? `${rationale.slice(0, 277)}...` : rationale;
  try {
    queuePost({
      bot,
      kind: "trade",
      text,
      dedupeKey: `decision:${decisionId}`,
      decisionId,
    });
  } catch (e) {
    console.error(`[engine] ${bot.slug} post failed to queue:`, e);
  }
  void executed;
}
