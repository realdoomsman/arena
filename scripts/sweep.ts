// Wind-down: sweep the SOL out of every bot wallet (and the treasury) to a
// destination address you control. For when the project is over.
//
// Moves SOL ONLY. It does not sell token positions — if a bot still holds
// memecoins, sell them back to SOL first (through the app) so their value is in
// SOL before you sweep, and to release the rent locked in their token accounts.
// A small reserve is left in each wallet so the sweep transaction can pay its
// own fee.
//
// DRY RUN by default.
//   npm run sweep -- <DESTINATION_ADDRESS>            # show what it would move
//   npm run sweep -- <DESTINATION_ADDRESS> --confirm  # actually send
import { listBots } from "../src/lib/bot-nav";
import { getTreasury } from "../src/lib/treasury";
import {
  getSolBalance,
  signSendConfirmOneWith,
  LAMPORTS_PER_SOL,
  WITHDRAW_RESERVE_LAMPORTS,
} from "../src/lib/accounts";
import { buildSolTransfer } from "../src/lib/swap";
import { isValidAddress } from "../src/lib/custody";
import { invalidateWallet } from "../src/lib/wallets";

const argv = process.argv.slice(2);
const confirm = argv.includes("--confirm");
const dest = argv.find((a) => !a.startsWith("--"));
const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(4);

async function main() {
  if (!dest || !isValidAddress(dest)) {
    console.error("Usage: npm run sweep -- <destination-address> [--confirm]");
    process.exitCode = 1;
    return;
  }

  const wallets: { label: string; address: string; key: string }[] = [];
  const t = getTreasury();
  if (t) wallets.push({ label: "treasury", address: t.wallet, key: t.encryptedKey });
  for (const b of listBots()) wallets.push({ label: b.slug, address: b.wallet, key: b.encrypted_key });

  console.log(`Sweeping SOL to ${dest}\n`);
  let grand = 0;
  for (const w of wallets) {
    if (w.address === dest) {
      console.log(`  ${w.label.padEnd(10)} SKIP — is the destination`);
      continue;
    }
    const bal = await getSolBalance(w.address);
    const send = bal - WITHDRAW_RESERVE_LAMPORTS;
    if (send <= 0) {
      console.log(`  ${w.label.padEnd(10)} ${sol(bal)} SOL — nothing to sweep (at/under reserve)`);
      continue;
    }
    console.log(`  ${w.label.padEnd(10)} ${sol(bal)} SOL  ->  send ${sol(send)} SOL`);
    grand += send;
    if (!confirm) continue;
    try {
      const tx = await buildSolTransfer(w.address, dest, send);
      const sig = await signSendConfirmOneWith(w.key, tx);
      invalidateWallet(w.address);
      console.log(`     OK  https://solscan.io/tx/${sig}`);
    } catch (e) {
      console.log(`     FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\n${confirm ? "swept" : "would sweep"} ~${sol(grand)} SOL total.`);
  if (!confirm) {
    console.log("Re-run with --confirm to send. (SOL only — token positions are NOT sold.)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
