import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

export async function GET() {
  return NextResponse.json({ user: await getUser() });
}
