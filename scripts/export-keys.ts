// Export every wallet's private key — for backup, or to reclaim funds when the
// project is over. Decrypts the AES-256-GCM key blobs from the database with
// ENCRYPTION_KEY and prints the base58 secret you can import into Phantom.
//
// PRINTS SECRETS. Run it inside the container over `railway ssh`, where the
// output goes only to your terminal. Anyone with these keys controls the funds.
//
//   npm run export-keys              # addresses only (no secrets)
//   npm run export-keys -- --confirm # print base58 private keys
import { listBots } from "../src/lib/bot-nav";
import { getTreasury, exportTreasurySecret } from "../src/lib/treasury";
import { exportSecretKey, custodyConfigured } from "../src/lib/custody";

const confirm = process.argv.includes("--confirm");

function main() {
  if (!custodyConfigured()) {
    console.error("ENCRYPTION_KEY is not set (or wrong length) — cannot decrypt any wallet.");
    process.exitCode = 1;
    return;
  }
  const bots = listBots();
  const treasury = getTreasury();

  if (!confirm) {
    console.log(`${bots.length} bot wallet(s)${treasury ? " + treasury" : ""}:\n`);
    if (treasury) console.log(`  treasury    ${treasury.wallet}`);
    for (const b of bots) console.log(`  ${b.slug.padEnd(10)}  ${b.wallet}`);
    console.log("\nAddresses only. Re-run with --confirm to print the base58 PRIVATE KEYS.");
    return;
  }

  console.log("\n============================================================");
  console.log(" PRIVATE KEYS — anyone with these controls the funds.");
  console.log(" Import into a wallet you control, then clear your terminal.");
  console.log("============================================================\n");

  if (treasury) {
    console.log(`treasury`);
    console.log(`  address: ${treasury.wallet}`);
    console.log(`  secret:  ${exportTreasurySecret()}\n`);
  }
  for (const b of bots) {
    console.log(`${b.name} (${b.slug})`);
    console.log(`  address: ${b.wallet}`);
    console.log(`  secret:  ${exportSecretKey(b.encrypted_key)}\n`);
  }
}

main();
