// Account wallets.
//
// Every account gets a real Solana wallet at signup. The secret key is
// AES-256-GCM encrypted at rest with ENCRYPTION_KEY and only ever decrypted
// in memory to sign a transaction the user asked for.
//
// Format matches the Scale project (iv:authTag:ciphertext, all hex) so one
// ENCRYPTION_KEY works across both codebases.
//
// SECURITY RULES enforced here:
//   • ENCRYPTION_KEY must exist and be exactly 32 bytes — no insecure default.
//   • A decrypted secret never leaves this module, is never logged, and is
//     never returned by any API.
//   • Withdrawals always leave the rent-exempt minimum so accounts survive.
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

const b58 = {
  encode: (b: Uint8Array): string => (bs58 as unknown as { default?: { encode(x: Uint8Array): string }; encode(x: Uint8Array): string }).default?.encode(b) ?? (bs58 as unknown as { encode(x: Uint8Array): string }).encode(b),
  decode: (s: string): Uint8Array => (bs58 as unknown as { default?: { decode(x: string): Uint8Array }; decode(x: string): Uint8Array }).default?.decode(s) ?? (bs58 as unknown as { decode(x: string): Uint8Array }).decode(s),
};

export class CustodyError extends Error {}

function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new CustodyError(
      "ENCRYPTION_KEY is not set — account wallets are disabled until it is configured"
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new CustodyError("ENCRYPTION_KEY must be 32 bytes (64 hex characters)");
  }
  return key;
}

export function custodyConfigured(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(secret, "utf8")), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptSecret(encrypted: string): string {
  const key = getEncryptionKey();
  const [ivHex, tagHex, dataHex] = encrypted.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new CustodyError("Corrupt key material");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const out = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return out.toString("utf8");
}

export type NewWallet = { address: string; encryptedKey: string };

/** Fresh wallet for a new account. Only the address is ever surfaced. */
export function generateWallet(): NewWallet {
  const kp = Keypair.generate();
  return {
    address: kp.publicKey.toBase58(),
    encryptedKey: encryptSecret(b58.encode(kp.secretKey)),
  };
}

/**
 * Rehydrate a signer. Callers must use it and drop it — never store, never log,
 * never pass it outside the server.
 */
export function loadSigner(encryptedKey: string): Keypair {
  const secret = decryptSecret(encryptedKey).trim();
  if (secret.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret) as number[]));
  }
  return Keypair.fromSecretKey(b58.decode(secret));
}

/**
 * The base58 secret for an encrypted key.
 *
 * Exists solely so an operator can back up the treasury once, at creation, by
 * importing it into a wallet they control. It is never returned over HTTP and
 * never logged — the only caller prints to a terminal a human is already
 * looking at. Every other use of a key goes through loadSigner, which keeps
 * the material inside this module.
 */
export function exportSecretKey(encryptedKey: string): string {
  return b58.encode(loadSigner(encryptedKey).secretKey);
}

/**
 * Can the configured key actually OPEN an existing wallet?
 *
 * custodyConfigured() only checks that ENCRYPTION_KEY is 32 bytes of hex. A
 * different 32-byte key is equally well-formed — so after a rotation, or a
 * deploy that picked up the wrong secret, every health check stayed green
 * while every wallet in the system had become permanently unopenable. That is
 * the worst failure shape available: silent, total, and discovered only at the
 * moment a bot tries to sign.
 *
 * AES-256-GCM authenticates, so decrypting with the wrong key fails loudly
 * rather than returning garbage. Trying it against one real wallet is a
 * complete test.
 */
export function custodyKeyOpens(encryptedKey: string): boolean {
  if (!encryptedKey) return false;
  try {
    loadSigner(encryptedKey);
    return true;
  } catch {
    return false;
  }
}

/** Solana addresses are base58 and 32-44 chars; reject anything else early. */
export function isValidAddress(addr: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return false;
  try {
    return b58.decode(addr).length === 32;
  } catch {
    return false;
  }
}
