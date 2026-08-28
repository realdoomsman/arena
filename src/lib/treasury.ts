// The house wallet.
//
// It pays two things and receives nothing back: the one-off genesis seed that
// gives each bot something to trade, and the recurring creator-fee injections
// that keep the eleven books close enough in size to stay comparable.
//
// ── WHY THE HOUSE HOLDS UNITS ───────────────────────────────────────────────
// The seed is not a gift to the bot; it BUYS units at the genesis price, same
// as anybody else's deposit. So the platform carries the identical exposure it
// asks users to take, and the first unit of every bot is owned by whoever runs
// it. A house that seeded without taking units would be risking nothing while
// asking users to risk something.
import { getDb } from "./db";
import { generateWallet, custodyConfigured, exportSecretKey } from "./custody";
import { getSolBalance } from "./accounts";

export class TreasuryError extends Error {}

export type Treasury = { wallet: string; encryptedKey: string; createdAt: number };

/** The treasury, or null if it has never been created. */
export function getTreasury(): Treasury | null {
  const row = getDb()
    .prepare("SELECT wallet, encrypted_key, created_at FROM treasury WHERE id = 1")
    .get() as { wallet: string; encrypted_key: string; created_at: number } | undefined;
  return row
    ? { wallet: row.wallet, encryptedKey: row.encrypted_key, createdAt: row.created_at }
    : null;
}

/**
 * Create the treasury if it does not exist. Idempotent and non-destructive:
 * an existing treasury is returned untouched, because regenerating it would
 * strand every lamport it holds behind a key nobody kept.
 */
export function ensureTreasury(): Treasury {
  if (!custodyConfigured()) {
    throw new TreasuryError(
      "ENCRYPTION_KEY is not set — refusing to create a treasury whose key cannot be encrypted at rest"
    );
  }
  const existing = getTreasury();
  if (existing) return existing;

  const w = generateWallet();
  getDb()
    .prepare("INSERT INTO treasury (id, wallet, encrypted_key, created_at) VALUES (1, ?, ?, ?)")
    .run(w.address, w.encryptedKey, Date.now());
  return { wallet: w.address, encryptedKey: w.encryptedKey, createdAt: Date.now() };
}

/**
 * The treasury's secret key, base58.
 *
 * Exists so an operator can back it up ONCE, at creation, and import it into a
 * wallet they control. It is never exposed over HTTP and never logged — the
 * only caller is the provisioning script, printing to a terminal a human is
 * already looking at.
 */
export function exportTreasurySecret(): string {
  const t = getTreasury();
  if (!t) throw new TreasuryError("No treasury exists yet");
  return exportSecretKey(t.encryptedKey);
}

export async function treasuryBalanceLamports(): Promise<number> {
  const t = getTreasury();
  if (!t) return 0;
  return await getSolBalance(t.wallet); // already lamports
}

export type LedgerKind = "seed" | "fee_injection" | "topup";

export function recordTreasuryLedger(args: {
  kind: LedgerKind;
  botId: number | null;
  lamports: number;
  signature: string | null;
  detail?: string;
}): void {
  getDb()
    .prepare(
      "INSERT INTO treasury_ledger (ts, kind, bot_id, lamports, signature, detail) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(Date.now(), args.kind, args.botId, args.lamports, args.signature, args.detail ?? "");
}

export type LedgerRow = {
  ts: number;
  kind: LedgerKind;
  bot_id: number | null;
  lamports: number;
  signature: string | null;
  detail: string;
};

/** Public disbursement history — every lamport the house has moved. */
export function treasuryLedger(limit = 200): LedgerRow[] {
  return getDb()
    .prepare("SELECT ts, kind, bot_id, lamports, signature, detail FROM treasury_ledger ORDER BY ts DESC LIMIT ?")
    .all(limit) as LedgerRow[];
}

export function totalDisbursed(): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(lamports), 0) AS total FROM treasury_ledger")
    .get() as { total: number };
  return row.total;
}
