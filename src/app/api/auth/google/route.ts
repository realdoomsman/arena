import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clientIp, rateLimit } from "@/lib/auth";
import { googleOAuthEnabled, googleAuthUrl, newOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth";

/** Step one: send the user to Google, carrying a state we can verify back. */
export async function GET(req: Request) {
  if (!googleOAuthEnabled()) {
    return NextResponse.json({ error: "Google sign-in is not configured" }, { status: 404 });
  }
  if (!rateLimit(`oauth:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts — wait a minute" }, { status: 429 });
  }

  const state = newOAuthState();
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // ten minutes to finish the Google screen
  });
  return NextResponse.redirect(googleAuthUrl(state));
}
