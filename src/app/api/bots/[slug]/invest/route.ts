import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { investInBot, InvestError } from "@/lib/bot-invest";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { slug } = await params;
  let body: { sol?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const sol = Number(body.sol);
  if (!Number.isFinite(sol) || sol <= 0) {
    return NextResponse.json({ error: "Enter an amount in SOL" }, { status: 400 });
  }

  try {
    const r = await investInBot(user.id, slug, Math.floor(sol * LAMPORTS_PER_SOL));
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    // An InvestError is a refusal we chose and can explain; anything else is a
    // bug or an outage and should not be dressed up as user error.
    if (e instanceof InvestError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[invest]", e);
    return NextResponse.json({ error: "The trade could not be completed" }, { status: 500 });
  }
}
