import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

declare global {
  // eslint-disable-next-line no-var
  var __aDb: DatabaseSync | undefined;
}

function createDb(): DatabaseSync {
  // DATA_DIR lets production mount a persistent volume for the SQLite file.
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "arena.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      -- Every account gets a real Solana wallet. wallet_key holds the
      -- AES-256-GCM encrypted secret (see lib/custody.ts); it is never
      -- returned by any API and never logged.
      wallet_address TEXT,
      wallet_key TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL
    );
    -- Display metadata for mints the bots have touched. Purely cosmetic: the
    -- eligible-list builder is the authority on what may be traded.
    CREATE TABLE IF NOT EXISTS token_meta (
      mint TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT,
      decimals INTEGER NOT NULL DEFAULT 6
    );
    -- ── AI trading bots ──────────────────────────────────────────────────
    -- Each bot is a REAL Solana wallet driven by one model (or, for the
    -- controls, by plain code with no model at all). Capital is POOLED: the
    -- house seeds it, users buy in, and everyone holds pro-rata units.
    CREATE TABLE IF NOT EXISTS bots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,      -- 'anthropic'|'openai'|'google'|'xai'|'deepseek'|'alibaba'|'none'
      model TEXT NOT NULL,         -- exact API model id; '' for code-driven controls
      kind TEXT NOT NULL,          -- 'model' | 'control'
      tagline TEXT NOT NULL DEFAULT '',
      -- Published verbatim on the bot's page. If the prompt is a secret, the
      -- leaderboard is unfalsifiable, and an unfalsifiable leaderboard is a
      -- marketing asset rather than an experiment.
      system_prompt TEXT NOT NULL,
      wallet TEXT UNIQUE NOT NULL,
      encrypted_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      -- Minute-of-hour this bot wakes. Staggered across the roster so the
      -- fleet does not pile into the same thin pool at :00 and front-run
      -- itself — with a dozen bots reading the same feed, simultaneous
      -- wake-ups make every bot a worse trader than it actually is.
      slot INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    -- Pro-rata claims on a bot's NAV. Buying in mints units at the live unit
    -- price; withdrawing burns them at the live unit price.
    CREATE TABLE IF NOT EXISTS bot_units (
      user_id INTEGER NOT NULL REFERENCES users(id),
      bot_id INTEGER NOT NULL REFERENCES bots(id),
      units REAL NOT NULL DEFAULT 0,
      cost_lamports INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, bot_id)
    );
    -- Every external movement of capital in or out of a bot wallet, with the
    -- NAV it was priced against. This table is what makes trading performance
    -- separable from wallet balance: strip these rows out of the equity curve
    -- and what is left is what the model actually earned.
    CREATE TABLE IF NOT EXISTS bot_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id INTEGER NOT NULL REFERENCES bots(id),
      user_id INTEGER REFERENCES users(id),  -- NULL for house seed & fee injections
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,        -- 'seed'|'deposit'|'withdraw'|'fee_injection'
      lamports INTEGER NOT NULL, -- signed: positive in, negative out
      units REAL NOT NULL,       -- minted (+) / burned (-); ALWAYS 0 for fee_injection
      nav_before INTEGER NOT NULL,
      unit_price REAL NOT NULL,  -- lamports per unit at the moment of the flow
      signature TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bot_flows ON bot_flows(bot_id, ts);
    -- TWO CURVES, DELIBERATELY DIFFERENT NUMBERS:
    --   nav_per_unit — what one unit is WORTH. Creator-fee injections raise it
    --                  without minting units, which is exactly how the fee
    --                  stream pays holders: same units, more SOL behind each.
    --   perf_index   — what the MODEL earned. Time-weighted, chained across
    --                  every flow, and injections do not touch it at all.
    -- A bot can be topped up all month and still print a losing perf_index.
    -- That is the point: balance is not performance.
    CREATE TABLE IF NOT EXISTS bot_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id INTEGER NOT NULL REFERENCES bots(id),
      ts INTEGER NOT NULL,
      nav_lamports INTEGER NOT NULL,
      sol_lamports INTEGER NOT NULL,
      units REAL NOT NULL,
      nav_per_unit REAL NOT NULL,
      perf_index REAL NOT NULL,
      holdings TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bot_snap ON bot_snapshots(bot_id, ts);
    -- One row per wake-up, written whether or not the bot traded. A hold is a
    -- decision and gets recorded like any other.
    CREATE TABLE IF NOT EXISTS bot_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id INTEGER NOT NULL REFERENCES bots(id),
      ts INTEGER NOT NULL,
      -- The exact JSON handed to the model. This column is the receipt that
      -- every bot saw identical data this hour; without it "Grok beat GPT" is
      -- a claim nobody outside the company can check.
      market_snapshot TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      actions TEXT NOT NULL DEFAULT '[]',
      -- Reasoning goes public only once the swaps confirm. Publishing "about
      -- to buy X" ahead of the fill hands free alpha to anyone refreshing the
      -- page, every hour, forever.
      published_at INTEGER,
      tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL, latency_ms INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bot_dec ON bot_decisions(bot_id, ts DESC);
    CREATE TABLE IF NOT EXISTS bot_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id INTEGER NOT NULL REFERENCES bots(id),
      decision_id INTEGER REFERENCES bot_decisions(id),
      ts INTEGER NOT NULL,
      mint TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,        -- 'buy' | 'sell'
      lamports INTEGER NOT NULL,
      qty REAL NOT NULL,
      price REAL NOT NULL,       -- USD at fill
      signature TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bot_trades ON bot_trades(bot_id, ts DESC);
    -- What each bot owns, and what it paid. Cost basis is per-bot, not
    -- per-holder: a unit is a claim on the whole book, not on a lot.
    CREATE TABLE IF NOT EXISTS bot_holdings (
      bot_id INTEGER NOT NULL REFERENCES bots(id),
      mint TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      cost_lamports INTEGER NOT NULL DEFAULT 0,
      opened_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bot_id, mint)
    );
    -- What each bot says in public, in its own voice.
    --
    -- Written whether or not it is ever transmitted: the website renders a
    -- bot's feed from THIS table, so the record is complete even with X
    -- disabled, and switching X on later does not retroactively invent history.
    --
    -- posted_at stays null until it actually reaches X. dedupe_key makes the
    -- queue idempotent — a restart mid-flush must never double-post, because a
    -- bot that tweets the same trade twice looks broken in a way that is very
    -- hard to walk back.
    CREATE TABLE IF NOT EXISTS bot_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id INTEGER NOT NULL REFERENCES bots(id),
      decision_id INTEGER REFERENCES bot_decisions(id),
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,            -- 'trade' | 'reflection' | 'milestone'
      text TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      posted_at INTEGER,
      external_id TEXT,              -- the X post id, once transmitted
      error TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_posts_dedupe ON bot_posts(bot_id, dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_bot_posts_feed ON bot_posts(bot_id, ts DESC);
    -- Exactly one process may run the wake-up loop.
    --
    -- Two schedulers means two wake-ups per hour, which means the same bot
    -- trades twice on one decision and the ledger permanently disagrees with
    -- the chain. A lease with a heartbeat is how a crashed holder eventually
    -- releases; a plain boolean would deadlock the arena after one hard kill.
    CREATE TABLE IF NOT EXISTS scheduler_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      holder TEXT NOT NULL,
      heartbeat_at INTEGER NOT NULL
    );
    -- One row per bot per hour, so a restart cannot re-run a wake already done.
    CREATE TABLE IF NOT EXISTS bot_wakes (
      bot_id INTEGER NOT NULL REFERENCES bots(id),
      hour_key TEXT NOT NULL,
      ran_at INTEGER NOT NULL,
      decision_id INTEGER REFERENCES bot_decisions(id),
      error TEXT,
      PRIMARY KEY (bot_id, hour_key)
    );
    -- The house wallet. Pays the genesis seed and the recurring fee injections.
    --
    -- One row, ever. Its key is encrypted with the same AES-256-GCM path as
    -- bot and account wallets, so there is exactly one key-management story in
    -- this codebase rather than three.
    CREATE TABLE IF NOT EXISTS treasury (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      wallet TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    -- Every disbursement the house makes, so "where did the seed go" is a query
    -- rather than an archaeology exercise.
    CREATE TABLE IF NOT EXISTS treasury_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,           -- 'seed' | 'fee_injection' | 'topup'
      bot_id INTEGER REFERENCES bots(id),
      lamports INTEGER NOT NULL,
      signature TEXT,
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_treasury_ledger ON treasury_ledger(ts DESC);
  `);
  return db;
}

export function getDb(): DatabaseSync {
  if (!globalThis.__aDb) {
    globalThis.__aDb = createDb();
  }
  return globalThis.__aDb;
}

/** The house account — holds the genesis seed units in every bot. */
export const SYSTEM_USERNAME = "arena";
