// Sign in with Google — the standard authorization-code flow, no SDK.
//
// Enabled only when GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are
// configured; without them the button simply does not render and the routes
// 404. The id_token is validated by Google's own tokeninfo endpoint (they
// check the signature; we check audience and email_verified), which keeps the
// entire flow dependency-free.
//
// The password never existed and the platform never sees one — for a product
// that already asks users to trust it with custody, "we cannot lose what we
// never held" is the honest pitch for OAuth.
import { randomBytes } from "node:crypto";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TOKENINFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo";

export const OAUTH_STATE_COOKIE = "arena_oauth_state";

export function googleOAuthEnabled(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function redirectUri(): string {
  const base = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/auth/google/callback`;
}

export function newOAuthState(): string {
  return randomBytes(16).toString("hex");
}

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

/**
 * Exchange the callback code for a VERIFIED email. Null on any failure —
 * callers treat null as "sign-in did not happen", never as an error page
 * with details an attacker could iterate against.
 */
export async function googleExchange(code: string): Promise<{ email: string } | null> {
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const { id_token } = (await res.json()) as { id_token?: string };
    if (!id_token) return null;

    // Google validates the token's signature; we validate it is OURS and the
    // email is real. An unverified email must never mint an account — it
    // would let anyone claim anyone.
    const info = await fetch(`${TOKENINFO_ENDPOINT}?id_token=${encodeURIComponent(id_token)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!info.ok) return null;
    const claims = (await info.json()) as {
      aud?: string;
      email?: string;
      email_verified?: string | boolean;
    };
    if (claims.aud !== process.env.GOOGLE_OAUTH_CLIENT_ID) return null;
    if (claims.email_verified !== "true" && claims.email_verified !== true) return null;
    const email = (claims.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return { email };
  } catch {
    return null;
  }
}

/** A username from an email, fitting the same rules typed signups follow. */
export function usernameFromEmail(email: string): string {
  const base = email
    .split("@")[0]
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 16);
  return base.length >= 3 ? base : `user${base}`;
}
