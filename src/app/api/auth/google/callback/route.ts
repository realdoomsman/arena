import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { createSession, clientIp, rateLimit } from "@/lib/auth";
import { custodyConfigured, generateWallet } from "@/lib/custody";
import { googleOAuthEnabled, googleExchange, usernameFromEmail, OAUTH_STATE_COOKIE } from "@/lib/oauth";

/**
 * Step two: Google sent the user back. Verify state, verify the email with
 * Google, then sign in — creating the account (and its wallet) on first
 * arrival. Every failure lands on /login with a generic marker: OAuth
 * callbacks are the classic place error detail turns into an oracle.
 */
export async function GET(req: Request) {
  const back = (path: string) =>
    NextResponse.redirect(new URL(path, process.env.SITE_URL ?? "http://localhost:3000"));

  if (!googleOAuthEnabled()) return back("/login");
  if (!rateLimit(`oauth-cb:${clientIp(req)}`, 10, 60_000)) return back("/login?error=google");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const expected = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete(OAUTH_STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) return back("/login?error=google");

  const identity = await googleExchange(code);
  if (!identity) return back("/login?error=google");

  const db = getDb();
  const existing = db.prepare("SELECT id, pass_hash FROM users WHERE email = ?").get(identity.email) as
    | { id: number; pass_hash: string }
    | undefined;

  if (existing) {
    // ACCOUNT-TAKEOVER DEFENSE. Registration never proves email ownership, so
    // a password row for this email may have been created by anyone. Google,
    // by contrast, has just PROVEN the person in front of us owns this email.
    // So Google is authoritative: on sign-in we neutralize any pre-existing
    // password (only Google can open the account henceforth) and revoke every
    // existing session, which locks out anyone who pre-registered the email.
    // A legitimate password user simply continues with Google — their email
    // was never verified anyway, so nothing trustworthy is lost.
    if (existing.pass_hash !== "oauth:google") {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE users SET pass_hash = 'oauth:google' WHERE id = ?").run(existing.id);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    await createSession(existing.id);
    return back("/account");
  }

  // First arrival: a real account with a real wallet, same as a typed signup.
  if (!custodyConfigured()) return back("/login?error=google");

  const wallet = generateWallet();
  const base = usernameFromEmail(identity.email);
  for (let attempt = 0; attempt < 5; attempt++) {
    const username = attempt === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    try {
      const res = db
        .prepare(
          "INSERT INTO users (email, username, pass_hash, wallet_address, wallet_key, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        // No password exists for this account — the sentinel can never match
        // any typed password because verifyPassword requires salt:hex-hash.
        .run(identity.email, username, "oauth:google", wallet.address, wallet.encryptedKey, Date.now());
      await createSession(Number(res.lastInsertRowid));
      return back("/account");
    } catch (e) {
      if (e instanceof Error && /UNIQUE constraint/i.test(e.message)) {
        // Email raced in from a parallel signup: just sign that account in.
        const raced = db.prepare("SELECT id FROM users WHERE email = ?").get(identity.email) as
          | { id: number }
          | undefined;
        if (raced) {
          await createSession(raced.id);
          return back("/account");
        }
        continue; // username collision — try a suffixed one
      }
      throw e;
    }
  }
  return back("/login?error=google");
}
