import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { withdrawFromBot, InvestError } from "@/lib/bot-invest";
import { getBot, getUserUnits } from "@/lib/bot-nav";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { slug } = await params;
  let body: { fraction?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const fraction = Number(body.fraction ?? 1);
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    return NextResponse.json({ error: "Choose how much to withdraw" }, { status: 400 });
  }

  const bot = getBot(slug);
  if (!bot) return NextResponse.json({ error: "No such bot" }, { status: 404 });

  const held = getUserUnits(user.id, bot.id);
  if (!(held.units > 0)) {
    return NextResponse.json({ error: "You have no position in this bot" }, { status: 400 });
  }

  try {
    const r = await withdrawFromBot(user.id, slug, held.units * fraction);
    return NextResponse.json({
      ok: true,
      ...r,
      solPaid: r.lamportsPaid / LAMPORTS_PER_SOL,
      solAtNav: r.lamportsAtNav / LAMPORTS_PER_SOL,
    });
  } catch (e) {
    if (e instanceof InvestError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[withdraw]", e);
    return NextResponse.json({ error: "The withdrawal could not be completed" }, { status: 500 });
  }
}
