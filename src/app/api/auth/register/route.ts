import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { clientIp, createSession, hashPassword, rateLimit } from "@/lib/auth";
import { custodyConfigured, generateWallet } from "@/lib/custody";

export async function POST(req: Request) {
  // Each signup costs a keypair generation, AES-GCM encryption and a scrypt
  // hash — real CPU on the same event loop that settles withdrawals. Unmetered,
  // that is a denial-of-service lever anyone can pull.
  if (!rateLimit(`register:${clientIp(req)}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many signups from here — wait a minute" }, { status: 429 });
  }

  let body: { email?: string; username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3-20 characters (letters, numbers, underscore)" },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  // An account without a wallet cannot fund a bot, and creating one that
  // silently cannot participate is worse than refusing the signup.
  if (!custodyConfigured()) {
    return NextResponse.json(
      { error: "Signups are closed — the server has no encryption key configured" },
      { status: 503 }
    );
  }

  const db = getDb();
  if (db.prepare("SELECT id FROM users WHERE email = ? OR username = ?").get(email, username)) {
    return NextResponse.json({ error: "Email or username already taken" }, { status: 409 });
  }

  const wallet = generateWallet();
  let res;
  try {
    res = db
      .prepare(
        "INSERT INTO users (email, username, pass_hash, wallet_address, wallet_key, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(email, username, hashPassword(password), wallet.address, wallet.encryptedKey, Date.now());
  } catch (e) {
    // Two signups racing the same email: the SELECT above is not atomic with
    // this INSERT, but the UNIQUE constraints are. The loser gets the same
    // answer it would have gotten a moment later, not a 500.
    if (e instanceof Error && /UNIQUE constraint/i.test(e.message)) {
      return NextResponse.json({ error: "Email or username already taken" }, { status: 409 });
    }
    throw e;
  }

  const userId = Number(res.lastInsertRowid);
  await createSession(userId);
  return NextResponse.json({ ok: true, user: { id: userId, email, username } });
}
