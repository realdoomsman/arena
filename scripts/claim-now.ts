// Claim pump.fun creator fees to the bots RIGHT NOW and report exactly what
// happened. This is the SAME crank the scheduler runs on its interval, invoked
// once by hand to prove the whole path works against the live coin.
//
// It is safe to run repeatedly: it only sends a transaction when accrued fees
// clear the program's minimum; otherwise it reports "below minimum" and sends
// nothing. Each bot's received share is booked as a fee_injection.
//
//   npm run claim-now
import { claimCreatorFees, creatorClaimEnabled } from "../src/lib/bot-fees-claim";
import { LAMPORTS_PER_SOL } from "../src/lib/accounts";

const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(6);

async function main() {
  const mint = process.env.PUMPFUN_TOKEN_MINT;
  console.log(`claiming enabled : ${creatorClaimEnabled()}`);
  console.log(`coin mint        : ${mint ?? "(unset)"}`);
  if (!creatorClaimEnabled()) {
    console.log("\nClaiming is OFF. Set PUMPFUN_TOKEN_MINT and ARENA_CREATOR_CLAIM_ENABLED=true.");
    return;
  }

  // Context: how much has accrued in the creator vault, and is it distributable?
  try {
    const { Connection, PublicKey } = await import("@solana/web3.js");
    const { OnlinePumpSdk } = await import("@pump-fun/pump-sdk");
    const { rpcUrl } = await import("../src/lib/swap");
    const conn = new Connection(rpcUrl(), "confirmed");
    const sdk = new OnlinePumpSdk(conn);
    const mintPk = new PublicKey(mint!);
    const min = await sdk.getMinimumDistributableFee(mintPk).catch((e: unknown) => {
      console.log("  (getMinimumDistributableFee threw:", e instanceof Error ? e.message : String(e), ")");
      return null;
    });
    if (min) console.log(`accrued/distributable now : canDistribute=${min.canDistribute}`);
  } catch (e) {
    console.log("(vault readout skipped:", e instanceof Error ? e.message : String(e), ")");
  }

  console.log("\nrunning claimCreatorFees() ...\n");
  const res = await claimCreatorFees();
  if (!res) {
    console.log("returned null — claiming disabled.");
    return;
  }
  if (res.skipped) {
    console.log(`SKIPPED: ${res.skipped}`);
    console.log("(This still proves the path reaches the coin and reads its fees — there is just");
    console.log(" nothing above the program minimum to distribute yet. It will fire once volume builds.)");
    return;
  }
  console.log(`landed: https://solscan.io/tx/${res.signature}`);
  for (const d of res.distributed) console.log(`  ${d.slug.padEnd(10)} +${sol(d.lamports)} SOL`);
  const total = res.distributed.reduce((a, d) => a + d.lamports, 0);
  console.log(`\ntotal distributed: ${sol(total)} SOL across ${res.distributed.length} bot(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
