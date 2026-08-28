// One capital operation per bot at a time — shared by the wake engine and the
// invest/withdraw paths so they SERIALIZE against each other.
//
// invest, withdraw and a bot's own wake all read holdings/units/NAV, move real
// SOL, then write the ledger. Any two interleaving on the same bot is how a
// double withdrawal pays twice, units go negative, or a wake's absolute-qty
// holdings write clobbers a concurrent withdrawal's sell (a silent lost
// update the chain still records). They queue instead. Per-bot, because a
// withdrawal from Opus has no reason to wait on Monkey's wake.
declare global {
  // eslint-disable-next-line no-var
  var __aInvestLocks: Map<number, Promise<unknown>> | undefined;
}

const botLocks = (globalThis.__aInvestLocks ??= new Map<number, Promise<unknown>>());

export function withBotLock<T>(botId: number, fn: () => Promise<T>): Promise<T> {
  const prev = botLocks.get(botId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  botLocks.set(
    botId,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}
