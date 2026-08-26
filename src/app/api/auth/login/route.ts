import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";

export async function POST(req: Request) {
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
  // endpoint cannot be used to enumerate who has an account here.
  if (!row || !row.pass_hash || !verifyPassword(password, row.pass_hash)) {
    return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
  }

  await createSession(row.id);
  return NextResponse.json({ ok: true, user: { id: row.id, email: row.email, username: row.username } });
}
