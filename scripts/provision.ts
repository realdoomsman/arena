import { provisionBots, publicBots, getSystemUserId } from "../src/lib/bot-provision";
const uid = getSystemUserId();
const r = provisionBots();
console.log(`house account user id: ${uid}`);
console.log(`created: ${r.created.length ? r.created.join(", ") : "none"}`);
console.log(`updated: ${r.updated.length ? r.updated.join(", ") : "none"}`);
console.log(`dark (no provider key): ${r.dark.map(d => d.slug).join(", ") || "none"}\n`);
console.log("slug      kind     wakes  wallet");
for (const b of publicBots()) {
  console.log(b.slug.padEnd(9), b.kind.padEnd(8), (":"+String(b.slot).padStart(2,"0")).padEnd(6), b.wallet);
}
