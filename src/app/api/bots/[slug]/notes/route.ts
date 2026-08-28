import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getBot } from "@/lib/bot-nav";
import { submitNote, NoteError, MAX_NOTE_CHARS } from "@/lib/bot-notes";

/**
 * A backer writes to their bot. Eligibility ($50+ live backing), screening,
 * and the daily cooldown are all enforced in lib/bot-notes — this route only
 * authenticates and translates errors.
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { slug } = await ctx.params;
  const bot = getBot(slug);
  if (!bot) return NextResponse.json({ error: "No such bot" }, { status: 404 });

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return NextResponse.json({ error: "Write something" }, { status: 400 });
  if (text.length > MAX_NOTE_CHARS * 3) {
    return NextResponse.json({ error: `Keep it under ${MAX_NOTE_CHARS} characters` }, { status: 400 });
  }

  try {
    const result = await submitNote(user.id, bot, text);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof NoteError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[api/notes]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
