import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { clientIp, createSession, hashPassword, rateLimit, verifyPassword } from "@/lib/auth";

// A real hash of a password nobody is sent, so a login attempt against a
// non-existent email costs the same scrypt work as one against a real account.
// Without it, response timing was an enumeration oracle that defeated the
// uniform error message below.
const DUMMY_HASH = hashPassword("timing-equalizer-not-a-real-password");

export async function POST(req: Request) {
  if (!rateLimit(`login:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts — wait a minute" }, { status: 429 });
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  const row = getDb()
    .prepare("SELECT id, email, username, pass_hash FROM users WHERE email = ?")
    .get(email) as { id: number; email: string; username: string; pass_hash: string } | undefined;

  // One message for both "no such account" and "wrong password", so the
  // endpoint cannot be used to enumerate who has an account here — and the
  // scrypt work runs on BOTH paths so timing does not leak what the message
  // withholds.
  const valid = verifyPassword(password, row?.pass_hash || DUMMY_HASH);
  if (!valid || !row) {
    return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
  }

  await createSession(row.id);
  return NextResponse.json({ ok: true, user: { id: row.id, email: row.email, username: row.username } });
}
