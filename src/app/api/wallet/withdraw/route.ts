import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { withdrawSol } from "@/lib/accounts";
import { CustodyError } from "@/lib/custody";

/**
 * Send SOL out of an account wallet to an address the user names.
 *
 * This is the exit door. A custodial product without one is a trap, so it
 * exists from the first release rather than being deferred until people ask.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: { destination?: string; sol?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const destination = (body.destination ?? "").trim();
  const sol = Number(body.sol);
  if (!destination) return NextResponse.json({ error: "Enter a destination address" }, { status: 400 });
  if (!Number.isFinite(sol) || sol <= 0) {
    return NextResponse.json({ error: "Enter an amount in SOL" }, { status: 400 });
  }

  try {
    const r = await withdrawSol(user.id, destination, sol);
    return NextResponse.json({ ok: true, signature: r.signature, lamports: r.lamports });
  } catch (e) {
    if (e instanceof CustodyError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[wallet/withdraw]", e);
    return NextResponse.json({ error: "The withdrawal could not be completed" }, { status: 500 });
  }
}
