# Arena — one process, one disk, one replica.
#
# The constraints this image encodes are not preferences:
#
#   NODE 24+       node:sqlite is not available before it, and the whole ledger
#                  is node:sqlite.
#
#   ONE REPLICA    the scheduler runs inside this process. Two containers means
#                  two schedulers waking the same bot on the same hour. There
#                  is a lease lock and a uniqueness constraint behind it, but
#                  they are a backstop, not a licence to scale out.
#
#   /data VOLUME   the SQLite file holds every bot's AES-256-GCM encrypted
#                  private key AND the unit ledger — who owns what share of
#                  which bot. Positions can be read back off the chain; the
#                  ownership behind them cannot. Without a persistent volume,
#                  a deploy destroys both.
#
#   NEXT_MANUAL_SIG_HANDLE=1
#                  without it Next installs its own SIGTERM handler and exits
#                  before instrumentation can drain in-flight trades, so a
#                  deploy can kill the process between a swap confirming
#                  on-chain and its ledger row committing.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A dummy key so the build can import modules that assert custody is
# configured. It never encrypts anything and never reaches the running image.
ENV ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# See the header — this is what makes the graceful drain actually run.
ENV NEXT_MANUAL_SIG_HANDLE=1
ENV DATA_DIR=/data
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json next.config.ts ./
COPY scripts ./scripts
COPY src ./src

# The ledger and the wallet keys live here. Mount it, or lose them.
VOLUME ["/data"]
RUN mkdir -p /data

EXPOSE 3000

# Node receives SIGTERM directly rather than through a shell that would swallow
# it — the drain depends on the signal reaching this process.
STOPSIGNAL SIGTERM

# 45s to drain in-flight trades, plus headroom. A shorter grace period than the
# drain window would defeat the drain.
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "next", "start"]
