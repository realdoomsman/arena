import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getAccountWallet, getSolBalance, LAMPORTS_PER_SOL } from "@/lib/accounts";
import { myPositions } from "@/lib/bot-invest";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const wallet = getAccountWallet(user.id);
  if (!wallet) return NextResponse.json({ error: "No wallet on this account" }, { status: 404 });

  // Never return encryptedKey. It is the account.
  return NextResponse.json({
    address: wallet.address,
    sol: (await getSolBalance(wallet.address)) / LAMPORTS_PER_SOL,
    positions: myPositions(user.id),
  });
}
