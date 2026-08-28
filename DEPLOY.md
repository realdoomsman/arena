# Deploying Automata

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

The database lives on the Railway volume, so provisioning and seeding must run
INSIDE the container — never on your laptop (a local run would write to a
local file and touch nothing in production).

1. Add `HELIUS_RPC_URL` and the provider keys you want awake (Railway →
   Variables). The service restarts itself.
2. Open `https://<site>/status` — every core row must be green except funding.
   Wallets self-provision at boot; the treasury does not exist yet.
3. Shell into the running service and create + inspect the treasury:
   ```
   railway ssh
   npm run seed          # dry run — creates the treasury, prints its address
   ```
4. Send SOL to the printed treasury address (11 SOL seeds every bot at 1 SOL,
   plus a little for fees), then, still inside the container:
   ```
   npm run seed -- --confirm
   ```
5. Watch the first hour on `/status` and `railway logs`. Bots wake on their
   slots; the first decisions appear within the hour.

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
