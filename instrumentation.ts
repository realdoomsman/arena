/**
 * Next runs this once per server process, before anything else.
 *
 * Three jobs: keep the process alive through bugs, shut down without
 * corrupting the books, and start the clock.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Node's default for an unhandled rejection is to CRASH. In a container that
  // means every visitor's request dies because one background fetch hiccuped —
  // and worse here, a bot could be mid-wake with a confirmed swap not yet
  // written to the ledger. These handlers turn a fatal crash into a logged
  // incident. Everything they catch is still a bug worth fixing.
  process.on("unhandledRejection", (reason) => {
    console.error(
      "[unhandledRejection] survived — this is a bug, but the server stays up:",
      reason instanceof Error ? reason.stack : reason
    );
  });

  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException] survived — this is a bug:", err?.stack ?? err);
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  // Every deploy SIGTERMs the old process. Next's own handler drains HTTP
  // requests and exits — but a bot's wake-up is not an HTTP request, so it was
  // being killed at whatever `await` it happened to be on.
  //
  // The dangerous window is between a swap CONFIRMING on-chain and its ledger
  // row committing: die there and the trade is real on Solana and invisible in
  // the books, permanently, with pooled user money on the wrong side of the
  // discrepancy. This waits for those sections to finish.
  //
  // Requires NEXT_MANUAL_SIG_HANDLE=1, or Next exits before this runs.
  const drain = async (signal: string) => {
    console.log(`[shutdown] ${signal} — draining in-flight trades`);
    try {
      const { drainAndWait } = await import("./src/lib/inflight");
      await drainAndWait(45_000);
    } catch (e) {
      console.error("[shutdown] drain failed:", e);
    }
    try {
      const { releaseLock } = await import("./src/lib/bot-scheduler");
      // Hand the scheduler lease back immediately rather than making the next
      // process wait out a 5-minute lease it could have had at once.
      releaseLock();
    } catch {
      /* the lease expires on its own; this is only an optimisation */
    }
    console.log("[shutdown] done");
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.on("SIGTERM", () => void drain("SIGTERM"));
  process.on("SIGINT", () => void drain("SIGINT"));

  if (process.env.NEXT_MANUAL_SIG_HANDLE !== "1") {
    console.warn(
      "[shutdown] NEXT_MANUAL_SIG_HANDLE is not set to 1 — Next will exit on SIGTERM before " +
        "in-flight trades finish recording. Set it in production."
    );
  }

  // Fail loudly at boot rather than at 3am when a bot without an identity
  // tries to post.
  void import("./src/lib/bot-persona")
    .then((m) => m.assertPersonasComplete())
    .catch((e) => console.error("[boot] persona check failed:", e));

  // Reconcile at boot. A restart is exactly when the ledger is most likely to
  // have been left behind by a kill mid-trade, so it is the right moment to
  // ask the chain whether the books still agree.
  void import("./src/lib/bot-reconcile")
    .then((m) => m.reconcileAll())
    .then((r) => {
      if (r.divergences.length === 0) {
        console.log(`[reconcile] clean — ${r.checkedSignatures} signature(s) across ${r.checkedBots} bots`);
      }
    })
    .catch((e) => console.error("[boot] reconcile failed:", e));

  // The clock. Gated behind ARENA_SCHEDULER_ENABLED so that running the site
  // locally never moves real money by accident — starting a dev server should
  // not be capable of making a bot trade.
  void import("./src/lib/bot-scheduler")
    .then((m) => m.ensureScheduler())
    .catch((e) => console.error("[boot] scheduler failed to start:", e));

  console.log("[instrumentation] crash guards installed");
}
