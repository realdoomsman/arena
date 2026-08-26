# Arena

**Eleven wallets, one argument.**

Eight frontier language models and three that do no thinking at all, each trading a real
Solana memecoin book on the same clock, from the same data, publishing every decision they
make. Anyone can put capital behind the one they believe in.

Every trade is a real on-chain swap. There is no paper trading and no simulated data
anywhere in the product.

---

## What it is

### The board

Each bot is a real Solana wallet. Once an hour it is handed the same three things — its
positions, its idle SOL, and a snapshot of the eligible token list — and it decides what to
do. The trade lands on-chain. Its reasoning is published next to the transaction signature.

Eight of the bots are models. Three are not:

| Control | What it does |
|---|---|
| **Monkey** | Picks at random from the same list, at the same size, on the same clock |
| **Index** | Top ten by volume, equal weight, rebalanced weekly |
| **Diamond** | Bought once at genesis and never sells |

The controls are not filler. Without them a green month only proves that memecoins went up,
and the leaderboard becomes a machine for mistaking beta for skill. *Beating the market is
not the bar. Beating the random picker is the bar.*

### Pooled capital

The house seeds each bot with 1 SOL. Anyone can buy in; capital pools in the bot's wallet
and everyone holds pro-rata **units**. Buying in mints units at the live unit price,
withdrawing burns them at the live unit price.

Seed 1 SOL, someone backs it with 2, the bot trades a 3 SOL book. It doubles to 6, and the
backer's two-thirds is worth 4 SOL.

This is a **custodial, pooled** design and the docs say so plainly.

### Balance is not performance

Recurring creator-fee revenue is injected into every bot wallet, split equally so an
unpopular bot is never starved. An injection adds SOL **without minting units** — so every
existing unit is instantly backed by more SOL. That is the mechanic that pays holders, and
it is exactly why the wallet balance cannot be the performance number.

So there are two curves, and they are deliberately different:

| Curve | Moved by | Used for |
|---|---|---|
| `nav_per_unit` | Trading results **and** fee injections | What a unit is worth. Prices every buy-in and withdrawal |
| `perf_index` | Trading results only — time-weighted, chained at every flow | What the model earned. **This is the leaderboard** |

A bot can be topped up all month and still print a losing `perf_index`. It should.

### Transparency

Every wake-up writes a row whether or not it traded — a hold is a decision. Each bot's page
publishes its positions and cost basis, its reasoning verbatim, the Solscan link for every
fill, its equity curve against the controls, its own system prompt in full, and **the exact
JSON it was handed**. That last one is the receipt that all eleven bots saw identical data;
without it, "Grok beat GPT" is a claim nobody outside the project can check.

Reasoning is published only *after* the swap confirms. Publishing intent ahead of the fill
would hand free alpha to anyone refreshing the page, every hour, forever.

---

## Design notes

Handling real funds and hostile inputs shaped most of the architecture.

| Concern | How it's handled |
|---|---|
| A model naming a token that doesn't exist | It cannot. The model returns an index into the tradeable list; it never writes a mint address |
| Prompt injection via token metadata | Token names are attacker-controlled. The prompt warns about it; the **executor** is the defence — a fully hijacked model still cannot buy something the safety gates excluded |
| A model ignoring its own rules | Trade caps, minimum sizes, cash floors and stop direction are validated in code. *A prompt is a suggestion* |
| A withdrawal against an unpriceable book | Refused with the reason shown, rather than settled at an invented NAV |
| A withdrawal diluting the holders who stayed | Beyond idle SOL, exits sell a pro-rata slice of every position and the leaver eats their own slippage |
| A deposit looking like a gain | Every flow snapshots NAV before it lands, so no reporting period contains a flow in its middle |
| Two schedulers double-trading one decision | The engine runs on exactly one process, under a database-level lock. The arena never scales horizontally |

## The tradeable universe

Wide on purpose. Three Jupiter feeds merged every five minutes — fresh launches,
trending, and organic-score — which is ~150 tokens including **pump.fun launches down to
$3k of liquidity**. That floor is technical, not editorial: below it Jupiter cannot route a
bot-sized order, so a position could be entered and never exited.

Stablecoins, liquid-staking tokens and wrapped majors are filtered out. A memecoin bot
buying JitoSOL is just holding SOL with extra steps.

**The index is not a limit on which coins.** A bot picks index `47`; it can never write a
mint address. That constrains how a token is *named*, not which tokens exist — so the list
can be the whole of Solana and the injection boundary is unchanged.

Safety runs at **execution**, on the one token a bot actually picked: freeze authority
(the honeypot — the deployer freezes your account and the position becomes unsellable),
mint authority, rug flag, extreme holder concentration. Gating the whole list instead
capped the universe at whatever RugCheck's 10-calls-per-minute free tier could clear —
about 33 tokens.

## Operating it

`/status` checks every precondition live and marks the blocking ones. It verifies the
encryption key by **actually decrypting a wallet**, not by checking its length — a
different 32-byte key is equally well-formed, and would otherwise read as healthy while
every wallet was permanently unopenable.

```bash
npm run provision   # create the 11 bot wallets (idempotent)
npm run seed        # dry run: prints the treasury address and what it would send
npm run wake -- monkey   # run one bot's hour by hand, same path the scheduler uses
npm run backup      # consistent snapshot via VACUUM INTO
```

> **`cp arena.db` is not a backup.** WAL keeps recent commits in a side file, so a plain
> copy of a live database silently dropped 5 of 16 tables in testing — including the
> treasury wallet key. Use `npm run backup`. And keep `ENCRYPTION_KEY` somewhere else
> entirely: together in one place, one breach takes both.

## Deployment

One always-on process, one persistent disk, **exactly one replica** — two schedulers would
wake the same bot twice on one decision. `Dockerfile` and `docker-compose.yml` encode all
three, plus `NEXT_MANUAL_SIG_HANDLE=1`, without which Next exits on SIGTERM before
in-flight trades finish recording.

Sizing: 2 vCPU / 2 GB / 50 GB. Decision snapshots store the full token list the model saw —
46 KB each, ~12 MB/day, ~4.3 GB/year — which is the receipt that every bot was handed
identical data, and worth the disk.

Not serverless: persistent process, persistent disk, single replica, and `node:sqlite`
needs Node 24+.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · `node:sqlite` · Tailwind v4

**Market data**, all keyless-capable: Jupiter (prices, three token feeds, swap quotes,
balances) · RugCheck (token safety) · Helius (RPC).

**Models**: Anthropic, OpenAI, Google, xAI, DeepSeek and Alibaba, each through its own
official SDK. A bot whose provider key is missing stays dark rather than trading badly.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in the keys you have
npm run dev
```

Only `ENCRYPTION_KEY` is strictly required — it encrypts bot wallet secrets. Generate one
with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Back it up.** Rotating or losing `ENCRYPTION_KEY` permanently locks every bot wallet,
> and those wallets hold pooled user capital.

```bash
npm test
```

The ledger tests are the ones that matter — they prove a bot whose balance grows 11× on
deposits alone still reports a 0% trading return.

---

## Disclaimer

Memecoins are extremely volatile and most go to zero. Running eleven of them in parallel
does not diversify that away — memecoins are highly correlated, so the whole board can be
red at once, and a fleet-wide drawdown is an expected outcome rather than a malfunction.
No bot on this board should be read as an expected return. Nothing in this repository or
product is investment advice.
