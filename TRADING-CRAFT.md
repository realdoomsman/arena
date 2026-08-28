# Trench Trading Craft Brief

How documented profitable Solana memecoin traders actually operate, synthesized from wallet-tracker analyses, on-chain studies, and practitioner tooling (2024–2026). Written for Arena's hourly-cadence LLM bots.

## Read this first: survivorship bias and base rates

Everything below is distilled from the *winners*. The base rates are brutal:

- Only ~6% of Solana meme wallets were profitable over a 90-day window in one on-chain study; the median trader lost money.
- Fewer than 2% of pump.fun launches ever graduate off the bonding curve; most tokens are dead within minutes, and most *graduated* tokens lose all meaningful activity within 24–48 hours.
- Monthly profitable-trader share on pump.fun stayed below 50% from April 2024 through late 2025, and even among winners, most made only $1–$500.
- Several "famous" trench names are famous for content, not audited PnL. The behavioral references here come from wallet-audited traders only.

Additionally, part of the elite edge is not judgment at all: it is execution infrastructure (premium RPC, block-0 bundles, sub-400ms fills) and reflexive copytrader flow. A simulation copying one top wallet with just a **10-second delay returned −21.3%**. Analysts also suspect some top-wallet PnL involves multi-wallet bundling and coordinated buying. Nothing here guarantees profit; these are heuristics from a hostile, negative-sum environment.

## The profitable archetypes

1. **Hyper-scalpers** (the dominant archetype): thousands of tiny trades/day on brand-new nano-caps, median holds of seconds to minutes, entries seconds after launch at $5K–$30K market caps, exits into the first demand wave (~$100K mcap). Average clip sizes $200–$650. Profits are thousands of small wins (~$33 average), not moonshots — one top wallet had only 14 of ~13,260 tokens go 5x+. **This archetype is structurally unavailable at hourly cadence.**
2. **Conviction accumulators**: early nano-cap entries held through price discovery, partial sells into pumps, moonbags kept. Rarer, streakier, but resolvable at hourly granularity.
3. **Selective size traders**: few tokens (dozens, not thousands), larger positions, ride consensus/smart-money entries. High win rates (~66%), high consistency.

## What statistically separates winners from losers

A 1,000-wallet study found only two metrics correlate with profitability:

- **Win rate** (correlation 0.610). Audited profitable wallets sit in the 52–68% band. Selectivity beats lottery hunting.
- **Max-loss control** (correlation −0.495). Losers are defined by a few catastrophic −80/90% holds. Winners never baghold.
- **Trade frequency was uncorrelated.** More trades is not more edge.

## Entries

- **Enter before or during price discovery, never after.** Whoever buys after the first leg is, structurally, the exit liquidity. Deployer-funded snipers exit ~85% of positions within 5 minutes at an 87% success rate — a pumped chart is usually their exit.
- **Momentum trigger = acceleration, not level.** Rising short-window volume across consecutive windows, with rising *unique* buyers and net-buy imbalance, beats any absolute cutoff. A single spike that decays is a distribution event, not an entry.
- **Breadth over intensity.** Heavy buy counts with flat unique-buyer/holder growth = one entity splitting orders (bot/wash pattern).
- **Holder growth beats trader count** as a predictor (one production dataset: ~64% stronger, risk-adjusted). A smooth "hockey stick" holder curve with no dips marks organic demand; stair-step identical-size jumps mark bundled bots.
- Treat each entry as a **cheap option on momentum**, not a thesis position.

## Exits

- **Scale out into strength, mechanically.** The documented pattern is selling most of a position into the first demand wave, often recovering initial capital at ~2x, then free-riding a residual. Winners sell in 1–2 swaps; >90% of profitable sniper wallets exit in 1–2 swap events.
- **Never round-trip a runner.** Once a position has run, letting it fall back to entry is the signature retail error. The residual "house money" runner is where the rare outsized wins come from — but only after most of the position is already banked.
- **Cut losers instantly.** No averaging down, no bagholding, no exceptions. The most consistent documented wallet had one $400 red day in seven months, achieved by scratching losers immediately. Practitioner hard line: exit trench plays around −50% at the absolute latest; the best exit far earlier when the momentum thesis breaks (imbalance inverts, holders decay, volume rolls over).
- There is little evidence of price-based stop-losses among top wallets — exits are *condition*-based (flow died) rather than level-based, but the effect is the same: losers get small fast.

## Sizing

- **Small, roughly uniform positions, many independent bets.** Even multi-million-PnL wallets average $200–$1,900 per trade. No single rug should be more than noise to the bankroll.
- **Size against liquidity, not conviction.** Chart price on a thin pool is unrealizable. Consensus: pool liquidity should be ≥10% of mcap (15–30% ideal; <5% is an exit trap). Your own position should be a small fraction of the pool or your exit *is* the dump.
- Losing retail does the opposite: oversized "conviction" entries into single tokens after the pump.

## Narrative (meta) awareness

- Memecoins pump in **narrative waves**: a cultural seed (viral moment, news event, AI experiment) → first-mover token runs → copycat deploy cluster confirms the meta → derivative wave → liquidity fragmentation → exhaustion. Individual token attention windows are days (CHILLGUY ~9 days launch→peak, GHIBLI 3 days); whole metas last weeks to months.
- **The first mover captures most of the upside.** Derivatives are short-lived scalps with much worse expectancy. Coins aligned with the live meta have tailwinds; off-meta launches mostly die.
- **Narrative filters the universe; momentum times the trade.** Elite scalpers barely care what a coin *is* — but the tokens that receive tradeable flow are overwhelmingly in the live meta.
- Meta death tells: derivatives stop bonding or instantly dump, mentions/mindshare roll over, lower highs on declining volume, rotation to a new family.
- **A monster launch is zero-sum**: it vacuums liquidity from everything else (TRUMP, Jan 2025). Celebrity launches specifically have a documented insider-loaded-supply pattern (HAWK, LIBRA, YZY) — extraction events, not holds.
- Dead metas can be resurrected by the original source re-engaging or major listings — second waves are smaller but more predictable.

## The supply audit (rug tells)

First-hour checks, mostly binary:

- Mint authority not revoked or freeze authority active → disqualify (honeypot risk).
- Top-10 holders: <20% clean, 20–30% caution, >50% skip; any single non-LP wallet >15–20% is coordinated-dump risk.
- Sniper/bundler/insider supply >30% → skip; snipers still holding size into a pump is a dump waiting.
- Dev behavior: a dev who *already sold early at low mcap* is a **pass** (overhang removed); a dev holding large supply is sell-pressure risk; a dev dumping into buyers mid-pump is the rug in progress.
- Liquidity: <$10K skip; >$50K pass; unburned/unlocked LP is disqualifying.
- Very high volume/mcap with flat holders = wash trading.
- Bonding curves that fill in <30 minutes are usually coordinated cabal launches.

**Caveat**: launch cabals deliberately structure supply to pass retail checklists. Even Axiom's own guide walked back universal numeric cutoffs. Use thresholds as a first pass, but weight *behavioral deltas* (cohorts exiting, holder retention) over static numbers.

## What transfers to hourly cadence — and what doesn't

**Unavailable**: second-level sniping, sub-minute scalps, bonding-curve launch games, livestream-spike plays, copytrader flow. By the time an hourly cycle fires, nano-cap launch plays have already resolved.

**Transferable** (the discipline layer):
- Small fixed sizing; many independent bets; a 100% loss on any one position is noise.
- Hard loss discipline; cut when the momentum/holder thesis breaks; never average down.
- Mechanical partial profit-taking into strength; keep a residual runner; never round-trip.
- Selectivity for win rate over moonshot hunting.
- Refusing entries on tokens already past price discovery.
- Narrative alignment as the universe filter; volume/holder acceleration as the trigger.
- Hourly-friendly windows: multi-day moment-coin waves, day-1 survivors showing holder retention, deeper-liquidity cult coins (which behave more like swing assets).