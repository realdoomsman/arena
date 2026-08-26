// Fund the bots from the treasury.
//
// DRY RUN BY DEFAULT. This script moves real SOL into eleven wallets that then
// trade it; making that the default behaviour of a script someone might run to
// "see what it does" would be indefensible. Pass --confirm to actually send.
//
//   npm run seed              # show exactly what would happen
//   npm run seed -- --confirm # do it
//
// The seed BUYS UNITS for the house at the genesis price rather than being a
// gift to the bot. The platform therefore holds the same instrument, priced
// the same way, as every user who backs a bot later.
import { ensureTreasury, getTreasury, exportTreasurySecret, treasuryBalanceLamports, recordTreasuryLedger } from "../src/lib/treasury";
import { listBots, getBotNav, recordFlow, unitsForDeposit, totalUnits } from "../src/lib/bot-nav";
import { getSystemUserId, provisionBots } from "../src/lib/bot-provision";
import { SEED_LAMPORTS } from "../src/lib/bots";
import { buildSolTransfer } from "../src/lib/swap";
import { signSendConfirmOneWith, LAMPORTS_PER_SOL, WITHDRAW_RESERVE_LAMPORTS } from "../src/lib/accounts";
import { invalidateWallet } from "../src/lib/wallets";

const confirm = process.argv.includes("--confirm");
const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(4);

async function main() {
  provisionBots();

  const fresh = !getTreasury();
  const treasury = ensureTreasury();

  if (fresh) {
    console.log("\n╔══════════════════════════════════════════════════════════════════╗");
    console.log("║  TREASURY CREATED — BACK THIS UP NOW, IT IS SHOWN ONCE            ║");
    console.log("╚══════════════════════════════════════════════════════════════════╝");
    console.log(`  address: ${treasury.wallet}`);
    console.log(`  secret:  ${exportTreasurySecret()}`);
    console.log("  Import that key into a wallet you control. Losing it strands");
    console.log("  every lamport the treasury holds.\n");
  }

  const bots = listBots(true);
  const balance = await treasuryBalanceLamports();
  const needed = bots.length * SEED_LAMPORTS + WITHDRAW_RESERVE_LAMPORTS;

  console.log(`treasury  ${treasury.wallet}`);
  console.log(`balance   ${sol(balance)} SOL`);
  console.log(`bots      ${bots.length}`);
  console.log(`seed each ${sol(SEED_LAMPORTS)} SOL`);
  console.log(`required  ${sol(needed)} SOL (includes a fee reserve)\n`);

  const unseeded = bots.filter((b) => totalUnits(b.id) === 0);
  const already = bots.length - unseeded.length;
  if (already > 0) console.log(`${already} bot(s) already seeded — skipping those.\n`);

  if (unseeded.length === 0) {
    console.log("Nothing to do: every bot already holds units.");
    return;
  }

  const requiredNow = unseeded.length * SEED_LAMPORTS + WITHDRAW_RESERVE_LAMPORTS;
  if (balance < requiredNow) {
    console.log(
      `SHORT by ${sol(requiredNow - balance)} SOL. Send at least ${sol(requiredNow)} SOL to:\n  ${treasury.wallet}\n`
    );
    if (confirm) process.exitCode = 1;
    return;
  }

  if (!confirm) {
    console.log("DRY RUN — would seed:");
    for (const b of unseeded) console.log(`  ${b.slug.padEnd(10)} ${sol(SEED_LAMPORTS)} SOL -> ${b.wallet}`);
    console.log("\nRe-run with --confirm to send.");
    return;
  }

  const houseId = getSystemUserId();
  for (const bot of unseeded) {
    process.stdout.write(`seeding ${bot.slug.padEnd(10)} `);
    try {
      // Price against NAV before the money lands, exactly like any deposit.
      const nav = await getBotNav(bot);
      if (!nav) {
        console.log("SKIPPED — NAV unknown");
        continue;
      }
      const units = unitsForDeposit(nav, SEED_LAMPORTS);
      const tx = await buildSolTransfer(treasury.wallet, bot.wallet, SEED_LAMPORTS);
      const signature = await signSendConfirmOneWith(treasury.encryptedKey, tx);

      recordFlow({ bot, nav, userId: houseId, kind: "seed", lamports: SEED_LAMPORTS, units, signature });
      recordTreasuryLedger({
        kind: "seed",
        botId: bot.id,
        lamports: SEED_LAMPORTS,
        signature,
        detail: `genesis seed for ${bot.slug}`,
      });
      invalidateWallet(bot.wallet);
      console.log(`OK  ${signature.slice(0, 12)}…`);
    } catch (e) {
      // One failure must not abort the rest; each transfer is independent and
      // already committed if it confirmed.
      console.log(`FAILED — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\ntreasury now ${sol(await treasuryBalanceLamports())} SOL`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
