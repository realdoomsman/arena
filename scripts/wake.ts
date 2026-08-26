// Trigger one bot's wake-up by hand.
//
// The scheduler fires once an hour at each bot's minute, which makes the engine
// impossible to exercise while building. This runs the identical code path
// runWake would run on the clock — no shortcuts, no mocks — so what you see
// here is what the scheduler will do.
//
//   npm run wake -- monkey
import { runWake } from "../src/lib/bot-engine";
import { listBots } from "../src/lib/bot-nav";

const slug = process.argv[2];

async function main() {
  if (!slug) {
    console.log("usage: npm run wake -- <slug>");
    console.log("bots:", listBots().map((b) => b.slug).join(", "));
    return;
  }

  console.log(`waking ${slug}…\n`);
  const r = await runWake(slug);

  if (r.error) {
    console.log(`ERROR: ${r.error}`);
    return;
  }
  console.log(`rationale: ${r.rationale || "(none)"}`);
  console.log(`executed:  ${r.executed}`);
  console.log(`refused:   ${r.refused}`);
  for (const n of r.notes) {
    console.log(`  ${n.kept ? "kept   " : "refused"} ${JSON.stringify(n.action)} — ${n.reason}`);
  }
  console.log(`\ndecision #${r.decisionId}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
