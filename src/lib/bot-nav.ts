// Pooled bot accounting. REAL MONEY ONLY.
//
// A bot's wallet holds everyone's capital. Ownership is expressed in UNITS —
// buying in mints them at the live unit price, withdrawing burns them at the
// live unit price. The house seeds the first unit, so it is exposed to its own
// bots exactly like anybody else.
//
// ── THE TWO CURVES ───────────────────────────────────────────────────────
// These are deliberately different numbers and must never be conflated:
//
//   nav_per_unit  what one unit is WORTH. Prices every buy-in and withdrawal.
//                 Creator-fee injections raise it, because an injection adds
//                 SOL without minting units — same units, more SOL behind each.
//                 That is precisely how the fee stream pays holders.
//
//   perf_index    what the MODEL earned. Time-weighted, chained across every
//                 flow, and injections never touch it.
//
// A bot can be topped up all month and still print a losing perf_index. It
// should. Balance is not performance, and the leaderboard reads perf_index.
//
// The chaining is EXACT rather than approximate: every flow snapshots NAV
// immediately before it lands, so no reporting period ever contains a flow in
// its middle and there is no need to assume when during the period it hit.
import { getDb } from "./db";
import { getPrices } from "./prices";
import { LAMPORTS_PER_SOL, getSolBalance } from "./accounts";
import { SOL_MINT } from "./wallets";
import { GENESIS_UNIT_PRICE } from "./bots";

export class BotNavError extends Error {}

export type BotRow = {
  id: number;
  slug: string;
  name: string;
  provider: string;
  model: string;
  kind: "model" | "control";
  tagline: string;
  system_prompt: string;
  wallet: string;
  encrypted_key: string;
  enabled: number;
  slot: number;
  created_at: number;
};

export type BotNav = {
  /** Total value of the wallet in lamports: idle SOL + every priced position. */
  navLamports: number;
  solLamports: number;
  positionsLamports: number;
  units: number;
  /** Lamports per unit. Genesis price is 1. */
  navPerUnit: number;
  holdings: { mint: string; qty: number; priceUsd: number; lamports: number }[];
};

export type FlowKind = "seed" | "deposit" | "withdraw" | "fee_injection";

export function getBot(idOrSlug: number | string): BotRow | null {
  const db = getDb();
  const row =
    typeof idOrSlug === "number"
      ? db.prepare("SELECT * FROM bots WHERE id = ?").get(idOrSlug)
      : db.prepare("SELECT * FROM bots WHERE slug = ?").get(idOrSlug);
  return (row as BotRow) ?? null;
}

export function listBots(onlyEnabled = false): BotRow[] {
  return getDb()
    .prepare(`SELECT * FROM bots ${onlyEnabled ? "WHERE enabled = 1" : ""} ORDER BY slot`)
    .all() as BotRow[];
}

export function totalUnits(botId: number): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(units), 0) AS u FROM bot_units WHERE bot_id = ?")
    .get(botId) as { u: number };
  return row.u;
}

/**
 * What a bot is worth right now, in lamports.
 *
 * Returns null when ANY held position cannot be priced. That is not a
 * degraded-but-usable answer — it is an unknown NAV, and every caller that
 * moves money must refuse rather than settle against a guess. Paying a
 * withdrawal at an invented valuation takes real SOL from the holders who
 * stayed, which is the exact failure the exit engine already refuses to make
 * when the price feed dies.
 */
export async function getBotNav(bot: BotRow): Promise<BotNav | null> {
  const db = getDb();
  const rows = db
    .prepare("SELECT mint, qty FROM bot_holdings WHERE bot_id = ? AND qty > 0")
    .all(bot.id) as { mint: string; qty: number }[];

  const sol = await getSolBalance(bot.wallet);
  const solLamports = Math.floor(sol * LAMPORTS_PER_SOL);

  if (rows.length === 0) {
    const units = totalUnits(bot.id);
    return {
      navLamports: solLamports,
      solLamports,
      positionsLamports: 0,
      units,
      navPerUnit: units > 0 ? solLamports / units : GENESIS_UNIT_PRICE,
      holdings: [],
    };
  }

  const prices = await getPrices([SOL_MINT, ...rows.map((r) => r.mint)]);
  const solPrice = prices[SOL_MINT]?.usdPrice ?? 0;
  if (!(solPrice > 0)) return null; // No SOL price means no lamport valuation at all.

  const holdings: BotNav["holdings"] = [];
  let positionsLamports = 0;
  for (const r of rows) {
    const priceUsd = prices[r.mint]?.usdPrice;
    // A dead token is priceable at zero only if the feed SAYS zero. A missing
    // entry means we do not know, and not knowing is not the same as worthless.
    if (priceUsd === undefined || priceUsd === null || !Number.isFinite(priceUsd)) return null;
    const lamports = Math.floor((r.qty * priceUsd * LAMPORTS_PER_SOL) / solPrice);
    positionsLamports += lamports;
    holdings.push({ mint: r.mint, qty: r.qty, priceUsd, lamports });
  }

  const navLamports = solLamports + positionsLamports;
  const units = totalUnits(bot.id);
  return {
    navLamports,
    solLamports,
    positionsLamports,
    units,
    navPerUnit: units > 0 ? navLamports / units : GENESIS_UNIT_PRICE,
    holdings,
  };
}

type SnapRow = { nav_lamports: number; perf_index: number; ts: number };

function lastSnapshot(botId: number): SnapRow | null {
  return (
    (getDb()
      .prepare(
        "SELECT nav_lamports, perf_index, ts FROM bot_snapshots WHERE bot_id = ? ORDER BY ts DESC, id DESC LIMIT 1"
      )
      .get(botId) as SnapRow) ?? null
  );
}

/**
 * Write one point on both curves.
 *
 * perf_index chains off the previous snapshot's NAV. Because every flow
 * snapshots immediately before it lands (see recordFlow), the interval between
 * two snapshots contains only trading — so the ratio of NAVs across it IS the
 * trading return for that interval, with no flow-timing assumption anywhere.
 */
export function writeSnapshot(bot: BotRow, nav: BotNav, ts = Date.now()): number {
  const prev = lastSnapshot(bot.id);
  let perfIndex = 1;
  if (prev && prev.nav_lamports > 0) {
    perfIndex = prev.perf_index * (nav.navLamports / prev.nav_lamports);
  } else if (prev) {
    // A bot that went to zero stays at zero: it cannot trade its way back from
    // an empty wallet, and dividing by zero would resurrect it as Infinity.
    perfIndex = prev.perf_index;
  }

  getDb()
    .prepare(
      `INSERT INTO bot_snapshots (bot_id, ts, nav_lamports, sol_lamports, units, nav_per_unit, perf_index, holdings)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      bot.id,
      ts,
      nav.navLamports,
      nav.solLamports,
      nav.units,
      nav.navPerUnit,
      perfIndex,
      JSON.stringify(nav.holdings.map((h) => [h.mint, h.qty, h.priceUsd]))
    );
  return perfIndex;
}

/**
 * Record capital moving in or out, and mint/burn the units that go with it.
 *
 * Snapshots FIRST, against pre-flow NAV. That single ordering rule is what
 * keeps perf_index honest: the trading curve is closed off at the price that
 * existed before the money arrived, so a deposit can never be mistaken for a
 * gain, and a withdrawal can never be mistaken for a loss.
 *
 * `units` is ALWAYS 0 for a fee_injection — that is the whole mechanic. SOL
 * arrives, no units are created, and every existing unit is worth more.
 */
export function recordFlow(args: {
  bot: BotRow;
  nav: BotNav;
  userId: number | null;
  kind: FlowKind;
  lamports: number; // signed: positive in, negative out
  units: number; // signed: minted positive, burned negative
  signature?: string | null;
}): void {
  const { bot, nav, kind, lamports, units } = args;
  if (kind === "fee_injection" && units !== 0) {
    throw new BotNavError("A fee injection must never mint units");
  }

  const db = getDb();
  const ts = Date.now();

  // 1. Close the trading period at pre-flow NAV.
  writeSnapshot(bot, nav, ts);

  // 2. Record the flow itself, priced at the NAV it was actually valued against.
  db.prepare(
    `INSERT INTO bot_flows (bot_id, user_id, ts, kind, lamports, units, nav_before, unit_price, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bot.id,
    args.userId,
    ts,
    kind,
    Math.round(lamports),
    units,
    nav.navLamports,
    nav.navPerUnit,
    args.signature ?? null
  );

  // 3. Move the units.
  if (units !== 0 && args.userId !== null) {
    db.prepare(
      `INSERT INTO bot_units (user_id, bot_id, units, cost_lamports)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, bot_id) DO UPDATE SET
         units = units + excluded.units,
         cost_lamports = MAX(0, cost_lamports + excluded.cost_lamports)`
    ).run(args.userId, bot.id, units, Math.round(lamports));
  }

  // 4. Reopen the period at post-flow NAV, carrying perf_index across unchanged
  //    — capital arriving or leaving is not a trading result.
  const post: BotNav = {
    ...nav,
    navLamports: nav.navLamports + Math.round(lamports),
    solLamports: nav.solLamports + Math.round(lamports),
    units: nav.units + units,
    navPerUnit: nav.navPerUnit, // unchanged by definition: flows price AT this
  };
  const prevPerf = lastSnapshot(bot.id)?.perf_index ?? 1;
  db.prepare(
    `INSERT INTO bot_snapshots (bot_id, ts, nav_lamports, sol_lamports, units, nav_per_unit, perf_index, holdings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bot.id,
    ts + 1,
    post.navLamports,
    post.solLamports,
    post.units,
    post.units > 0 ? post.navLamports / post.units : GENESIS_UNIT_PRICE,
    prevPerf,
    JSON.stringify(nav.holdings.map((h) => [h.mint, h.qty, h.priceUsd]))
  );
}

/** Units a buy-in of `lamports` mints at the current price. */
export function unitsForDeposit(nav: BotNav, lamports: number): number {
  const price = nav.units > 0 ? nav.navPerUnit : GENESIS_UNIT_PRICE;
  if (!(price > 0)) throw new BotNavError("Unit price is zero — this bot cannot take deposits");
  return lamports / price;
}

/** Lamports owed for burning `units` at the current price. */
export function lamportsForUnits(nav: BotNav, units: number): number {
  return Math.floor(units * nav.navPerUnit);
}

export function getUserUnits(userId: number, botId: number): { units: number; cost: number } {
  const row = getDb()
    .prepare("SELECT units, cost_lamports FROM bot_units WHERE user_id = ? AND bot_id = ?")
    .get(userId, botId) as { units: number; cost_lamports: number } | undefined;
  return { units: row?.units ?? 0, cost: row?.cost_lamports ?? 0 };
}

export type CurvePoint = [ts: number, navPerUnit: number, perfIndex: number];

export function getBotCurve(botId: number, sinceTs = 0): CurvePoint[] {
  return (
    getDb()
      .prepare(
        "SELECT ts, nav_per_unit, perf_index FROM bot_snapshots WHERE bot_id = ? AND ts >= ? ORDER BY ts"
      )
      .all(botId, sinceTs) as { ts: number; nav_per_unit: number; perf_index: number }[]
  ).map((r) => [r.ts, r.nav_per_unit, r.perf_index] as CurvePoint);
}

/**
 * Time-weighted trading return over a window — the leaderboard number.
 * Null when there is not enough history to make a claim, which is honest:
 * a bot that has existed for an hour has no return worth printing.
 */
export function getBotReturn(botId: number, windowMs: number): number | null {
  const since = Date.now() - windowMs;
  const first = getDb()
    .prepare("SELECT perf_index FROM bot_snapshots WHERE bot_id = ? AND ts >= ? ORDER BY ts LIMIT 1")
    .get(botId, since) as { perf_index: number } | undefined;
  const last = lastSnapshot(botId);
  if (!first || !last || !(first.perf_index > 0)) return null;
  return last.perf_index / first.perf_index - 1;
}

/** How much SOL is following a bot — the popularity figure, never a performance one. */
export function botAum(botId: number): { units: number; holders: number } {
  const row = getDb()
    .prepare(
      "SELECT COALESCE(SUM(units),0) AS u, COUNT(*) AS n FROM bot_units WHERE bot_id = ? AND units > 0"
    )
    .get(botId) as { u: number; n: number };
  return { units: row.u, holders: row.n };
}
