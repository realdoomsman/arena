# Deploying Arena

One process, one disk, one replica — see the Dockerfile header for why each of
those is a hard requirement.

## Railway (current production)

The repo is linked to Railway: every push to `main` on GitHub auto-builds the
Dockerfile and deploys.

- Project: `arena` (service `arena`, environment `production`)
- Public URL: https://arena-production-19f5.up.railway.app
- Volume: `arena-volume` mounted at `/data` — the SQLite ledger and every
  encrypted wallet key live there. Never detach it from a live service.

### Environment variables

Set on the service (Railway → arena → Variables):

| Variable | State | Notes |
|---|---|---|
| `ENCRYPTION_KEY` | **set** | Fresh production key, distinct from any dev key. Backed up locally in `.prod-encryption-key.backup.txt` (gitignored) — copy it somewhere safe offline. Losing it permanently locks every wallet. |
| `ARENA_SCHEDULER_ENABLED` | `true` | The clock runs; with no funded wallets every wake is a harmless no-op. |
| `ARENA_SOCIAL_ENABLED` | `false` | Posting to X stays a deliberate human act. |
| `ARENA_WAKES_PER_HOUR` | `1` | Raise to 2/3/4/6/12 for memecoin-time cadence (multiplies inference spend). |
| `NEXT_MANUAL_SIG_HANDLE` | `1` | Lets the in-flight-trade drain actually run on deploys. |
| `SITE_URL` | set | The public URL above. |
| `HELIUS_RPC_URL` | **you add** | Recommended before funding anything — swap landing rate depends on it. |
| `ANTHROPIC_API_KEY` etc. | **you add** | One per model family; a bot without its key stays dark. |
| `JUPITER_API_KEY` | optional | Flips market data to the paid host. |

### Going live with real money — in order

1. Add `HELIUS_RPC_URL` and the provider keys you want awake.
2. Open `https://<site>/status` — every core row must be green except funding.
3. From a machine with the PRODUCTION key in `.env.local`:
   `npm run provision` (creates the 11 wallets against the prod DB — or just
   let the boot do it), then `npm run seed` (dry run) and
   `npm run seed -- --confirm` after sending the treasury enough SOL.
4. Watch the first hour on `/status` and the Railway logs.

### Backups

`npm run backup` takes a WAL-safe `VACUUM INTO` snapshot. On Railway, download
the volume periodically (`railway volume` tooling) or run the backup script in
a cron. The DB plus the `ENCRYPTION_KEY` together are the whole system state.

## Docker anywhere else

```bash
cp .env.example .env
docker compose up -d --build
```

`docker-compose.yml` encodes the same constraints: one replica, 60s stop grace
(longer than the 45s trade drain), `/data` volume.
