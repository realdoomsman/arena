import Link from "next/link";
import { getDb } from "@/lib/db";
import { listBots } from "@/lib/bot-nav";
import { getTreasury, treasuryBalanceLamports } from "@/lib/treasury";
import { buildEligibleList } from "@/lib/bot-universe";
import { custodyConfigured, custodyKeyOpens } from "@/lib/custody";
import { lastReconcile, staleness, crashedWakes } from "@/lib/bot-reconcile";
import { socialEnabled, botHasSocialCredentials } from "@/lib/bot-social";
import { PROVIDER_KEY, BOT_ROSTER, SEED_LAMPORTS, type Provider } from "@/lib/bots";
import { LAMPORTS_PER_SOL } from "@/lib/accounts";
import { Scroller } from "@/components/Scroller";

export const dynamic = "force-dynamic";
export const metadata = { title: "Status — Automata" };

type Check = { label: string; ok: boolean | null; detail: string; blocking: boolean };

/**
 * Will this actually run?
 *
 * Every precondition, checked live rather than asserted. "It should work" is
 * not a claim anyone can act on; this turns it into a list of things that are
 * either true or not, and says plainly which ones stop the bots trading.
 */
export default async function StatusPage() {
  const db = getDb();
  const bots = listBots();
  const treasury = getTreasury();

  const recon = lastReconcile();
  const quiet = staleness();
  const crashed = crashedWakes();
  // Prove the key OPENS a wallet, not merely that it is well-formed.
  const sample = getDb().prepare("SELECT encrypted_key FROM bots LIMIT 1").get() as
    | { encrypted_key: string }
    | undefined;
  const keyOpens = sample ? custodyKeyOpens(sample.encrypted_key) : null;

  const [balance, eligible] = await Promise.all([
    treasuryBalanceLamports().catch(() => 0),
    buildEligibleList().catch(() => []),
  ]);

  const funded = bots.filter((b) => {
    const u = db
      .prepare("SELECT COALESCE(SUM(units),0) AS u FROM bot_units WHERE bot_id = ?")
      .get(b.id) as { u: number };
    return u.u > 0;
  }).length;

  const needed = bots.length * SEED_LAMPORTS;
  const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(3);

  const core: Check[] = [
    {
      label: "encryption key",
      ok: custodyConfigured() ? (keyOpens === false ? false : true) : false,
      detail: !custodyConfigured()
        ? "MISSING — no wallet can be created or signed with"
        : keyOpens === false
          ? "WRONG KEY — well-formed, but it cannot decrypt an existing wallet. Every wallet is unopenable until the original key is restored"
          : keyOpens === true
            ? "set, and verified against a real wallet"
            : "set (no wallet yet to verify against)",
      blocking: true,
    },
    {
      label: "bots provisioned",
      ok: bots.length === BOT_ROSTER.length,
      detail: `${bots.length} of ${BOT_ROSTER.length} wallets exist`,
      blocking: true,
    },
    {
      label: "treasury",
      ok: Boolean(treasury),
      detail: treasury ? treasury.wallet : "not created — run npm run seed",
      blocking: true,
    },
    {
      label: "treasury balance",
      ok: balance >= needed ? true : balance > 0 ? null : false,
      detail:
        balance >= needed
          ? `${sol(balance)} SOL — enough to seed all ${bots.length}`
          : `${sol(balance)} SOL — need ${sol(needed)} to seed every bot`,
      blocking: true,
    },
    {
      label: "bots funded",
      ok: funded > 0,
      detail:
        funded > 0
          ? `${funded} of ${bots.length} hold units and can trade`
          : "none — the scheduler runs, but every wake returns 'wallet is empty'",
      blocking: true,
    },
    {
      label: "token universe",
      ok: eligible.length > 0,
      detail:
        eligible.length > 0
          ? `${eligible.length} tokens reachable, rebuilt every 5 minutes`
          : "empty — every Jupiter feed was unreachable",
      blocking: true,
    },
    {
      label: "scheduler",
      ok: process.env.ARENA_SCHEDULER_ENABLED === "true",
      detail:
        process.env.ARENA_SCHEDULER_ENABLED === "true"
          ? "armed — one tick per minute, must run on exactly one process"
          : "off — set ARENA_SCHEDULER_ENABLED=true",
      blocking: true,
    },
    {
      label: "ledger vs chain",
      ok: recon === null ? null : recon.divergences.length === 0 ? true : false,
      detail:
        recon === null
          ? "not reconciled yet — runs at boot"
          : recon.divergences.length === 0
            ? `clean — ${recon.checkedSignatures} signature(s) across ${recon.checkedBots} bots${recon.unreachable.length ? `, ${recon.unreachable.length} wallet(s) unreadable` : ""}`
            : `${recon.divergences.length} on-chain transaction(s) missing from the ledger: ${recon.divergences.map((d) => d.botSlug).join(", ")}`,
      blocking: true,
    },
    {
      label: "crashed wakes",
      ok: crashed.length === 0,
      detail:
        crashed.length === 0
          ? "none — every wake that started also finished"
          : `${crashed.length} wake(s) started and never finished: ${[...new Set(crashed.map((c) => c.slug))].join(", ")} — check those wallets against the chain`,
      blocking: false,
    },
    {
      label: "activity",
      ok:
        quiet.hoursQuiet === null ? null : quiet.hoursQuiet < 3 ? true : false,
      detail:
        quiet.hoursQuiet === null
          ? "no decision has ever been recorded"
          : quiet.hoursQuiet < 3
            ? `last decision ${quiet.hoursQuiet.toFixed(1)}h ago`
            : `SILENT for ${quiet.hoursQuiet.toFixed(1)}h — bots should decide hourly even when they hold`,
      blocking: false,
    },
    {
      label: "X transmission",
      ok: socialEnabled() ? true : null,
      detail: socialEnabled()
        ? "on — bots post publicly"
        : "off — posts are written and shown here, but never leave the building",
      blocking: false,
    },
  ];

  const providers = [
    ...new Set(BOT_ROSTER.filter((b) => b.provider !== "none").map((b) => b.provider)),
  ];

  return (
    <Scroller>
      <div className="mx-auto max-w-4xl px-5 py-7">
        <h1 className="display text-2xl">Status</h1>
        <p className="mt-2 max-w-[64ch] text-[0.86rem] leading-relaxed text-ink2">
          Every precondition, checked live. Anything marked{" "}
          <span className="text-bad">blocking</span> stops bots trading until it is fixed.
        </p>

        <Section title="core">
          {core.map((c) => (
            <Row key={c.label} check={c} />
          ))}
        </Section>

        <Section
          title="model providers"
          note="a bot without its key stays dark rather than trading badly"
        >
          {providers.map((p) => {
            const env = PROVIDER_KEY[p as Provider];
            const has = Boolean(env && process.env[env]);
            const which = BOT_ROSTER.filter((b) => b.provider === p)
              .map((b) => b.name)
              .join(", ");
            return (
              <Row
                key={p}
                check={{
                  label: p,
                  ok: has,
                  detail: has
                    ? `${env} set — ${which} can think`
                    : `${env} missing — ${which} asleep`,
                  blocking: false,
                }}
              />
            );
          })}
          <Row
            check={{
              label: "controls",
              ok: true,
              detail: "Monkey, Index and Diamond need no key and always run",
              blocking: false,
            }}
          />
        </Section>

        <Section title="bot X accounts">
          {BOT_ROSTER.map((b) => (
            <Row
              key={b.slug}
              check={{
                label: b.name,
                ok: botHasSocialCredentials(b.slug) ? true : null,
                detail: botHasSocialCredentials(b.slug)
                  ? "credentials present"
                  : `X_${b.slug.toUpperCase()}_ACCESS_TOKEN not set — writes but does not transmit`,
                blocking: false,
              }}
            />
          ))}
        </Section>

        <p className="mt-8 font-mono text-[0.66rem] leading-relaxed text-ink3">
          Seed: <span className="text-ink2">npm run seed</span> (dry run), then{" "}
          <span className="text-ink2">npm run seed -- --confirm</span>. One wake by hand:{" "}
          <span className="text-ink2">npm run wake -- monkey</span>. The room is{" "}
          <Link href="/" className="text-brand">
            here
          </Link>
          .
        </p>
      </div>
    </Scroller>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7">
      <div className="section-label">
        <span>{title}</span>
        {note && <span className="text-ink3 normal-case tracking-normal">{note}</span>}
      </div>
      <ul className="card card-glass mt-2 divide-y divide-hairline overflow-hidden">
        {children}
      </ul>
    </section>
  );
}

function Row({ check }: { check: Check }) {
  const dot = check.ok === true ? "bg-good" : check.ok === false ? "bg-bad" : "bg-warn";
  return (
    <li className="flex items-baseline gap-3 px-4 py-2">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="w-36 shrink-0 font-mono text-[0.72rem] text-ink">{check.label}</span>
      <span className="flex-1 font-mono text-[0.72rem] leading-relaxed text-ink2">
        {check.detail}
      </span>
      {check.ok === false && check.blocking && (
        <span className="badge badge-danger shrink-0">blocking</span>
      )}
    </li>
  );
}
