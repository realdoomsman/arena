// Bringing bots into existence.
//
// Provisioning is deliberately split from FUNDING. This module generates a
// real Solana keypair per bot and writes the roster to the database; it never
// moves SOL. Funding is a separate, explicit act — because the moment a bot
// wallet holds money it holds pooled user money, and that should never be a
// side effect of a deploy.
//
// Idempotent: safe to run on every boot. A bot that already exists keeps its
// wallet and its history, and only its editable presentation fields are
// refreshed from the roster spec. The wallet address is never regenerated —
// doing so would orphan the funds and the entire trading record behind it.
import { getDb, SYSTEM_USERNAME } from "./db";
import { generateWallet, custodyConfigured } from "./custody";
import { BOT_ROSTER, SHARED_SYSTEM_PROMPT, botKeyPresent, type Provider } from "./bots";
import type { BotRow } from "./bot-nav";

export class ProvisionError extends Error {}

/**
 * The house account. It holds the genesis units of every bot, so the platform
 * carries the same exposure it asks users to take.
 */
export function getSystemUserId(): number {
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(SYSTEM_USERNAME) as { id: number } | undefined;
  if (row) return row.id;

  db.prepare(
    "INSERT INTO users (email, username, pass_hash, created_at) VALUES (?, ?, '', ?)"
  ).run(`${SYSTEM_USERNAME}@arena.local`, SYSTEM_USERNAME, Date.now());
  return (
    db.prepare("SELECT id FROM users WHERE username = ?").get(SYSTEM_USERNAME) as { id: number }
  ).id;
}

export type ProvisionResult = {
  created: string[];
  updated: string[];
  /** Bots whose provider key is absent — they exist but will not be woken. */
  dark: { slug: string; provider: Provider }[];
};

/**
 * Create any missing bot, refresh presentation fields on the rest.
 *
 * Requires ENCRYPTION_KEY: a bot wallet whose secret cannot be encrypted must
 * not be created at all, because the alternative is writing a private key to
 * disk in the clear and then forgetting we did.
 */
export function provisionBots(): ProvisionResult {
  if (!custodyConfigured()) {
    throw new ProvisionError(
      "ENCRYPTION_KEY is not set — refusing to generate bot wallets that cannot be encrypted at rest"
    );
  }

  const db = getDb();
  const result: ProvisionResult = { created: [], updated: [], dark: [] };

  for (const spec of BOT_ROSTER) {
    const existing = db.prepare("SELECT id FROM bots WHERE slug = ?").get(spec.slug) as
      | { id: number }
      | undefined;

    if (existing) {
      // Never touches wallet or encrypted_key. Taglines and prompts may be
      // edited; the identity and the money behind it may not.
      db.prepare(
        `UPDATE bots SET name = ?, provider = ?, model = ?, kind = ?, tagline = ?,
                         system_prompt = ?, slot = ? WHERE id = ?`
      ).run(
        spec.name,
        spec.provider,
        spec.model,
        spec.kind,
        spec.tagline,
        spec.kind === "model" ? SHARED_SYSTEM_PROMPT : "",
        spec.slot,
        existing.id
      );
      result.updated.push(spec.slug);
    } else {
      const wallet = generateWallet();
      db.prepare(
        `INSERT INTO bots (slug, name, provider, model, kind, tagline, system_prompt,
                           wallet, encrypted_key, enabled, slot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        spec.slug,
        spec.name,
        spec.provider,
        spec.model,
        spec.kind,
        spec.tagline,
        spec.kind === "model" ? SHARED_SYSTEM_PROMPT : "",
        wallet.address,
        wallet.encryptedKey,
        spec.slot,
        Date.now()
      );
      result.created.push(spec.slug);
    }

    if (!botKeyPresent(spec.provider)) {
      result.dark.push({ slug: spec.slug, provider: spec.provider });
    }
  }

  // Reconcile: a bot removed from the roster should leave the arena. Delete it
  // only when it holds NO money (no outstanding units, no trades) — history and
  // wakes go with it, which is acceptable for a retired bot but real money is
  // never silently discarded. A retired bot that still holds money is disabled
  // instead and logged, so a human settles it before it disappears.
  const rosterSlugs = new Set(BOT_ROSTER.map((b) => b.slug));
  const strays = db.prepare("SELECT id, slug FROM bots").all() as { id: number; slug: string }[];
  for (const s of strays) {
    if (rosterSlugs.has(s.slug)) continue;
    const units = (db.prepare("SELECT COALESCE(SUM(units),0) AS u FROM bot_units WHERE bot_id = ?").get(s.id) as { u: number }).u;
    const trades = (db.prepare("SELECT COUNT(*) AS n FROM bot_trades WHERE bot_id = ?").get(s.id) as { n: number }).n;
    if (units > 0 || trades > 0) {
      db.prepare("UPDATE bots SET enabled = 0 WHERE id = ?").run(s.id);
      console.warn(`[provision] ${s.slug} left the roster but still holds money (units=${units}, trades=${trades}) — disabled, not deleted. Settle it by hand.`);
      continue;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const t of ["bot_notes", "bot_playbook_history", "bot_playbooks", "bot_snapshots", "bot_flows", "bot_holdings", "bot_units", "bot_posts", "bot_wakes", "bot_decisions"]) {
        db.prepare(`DELETE FROM ${t} WHERE bot_id = ?`).run(s.id);
      }
      db.prepare("DELETE FROM bots WHERE id = ?").run(s.id);
      db.exec("COMMIT");
      console.log(`[provision] removed retired bot ${s.slug} (held no money)`);
    } catch (e) {
      db.exec("ROLLBACK");
      console.error(`[provision] failed to remove ${s.slug}:`, e);
    }
  }

  return result;
}

/**
 * Bots that are ready to be woken: enabled, and with a provider key present.
 *
 * A model bot without its key is skipped rather than run — a bot that trades
 * badly because its brain is unreachable would pollute the leaderboard with a
 * result that says nothing about the model.
 */
export function wakeableBots(): BotRow[] {
  return (getDb().prepare("SELECT * FROM bots WHERE enabled = 1 ORDER BY slot").all() as BotRow[])
    .filter((b) => botKeyPresent(b.provider as Provider));
}

/** Every bot's public identity — safe to serialise; never includes the key. */
export function publicBots(): Omit<BotRow, "encrypted_key">[] {
  const rows = getDb().prepare("SELECT * FROM bots ORDER BY slot").all() as BotRow[];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the discard IS the point
  return rows.map(({ encrypted_key, ...rest }) => rest);
}
