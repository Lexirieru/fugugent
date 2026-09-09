# VPS Deployment

Everything needed to run the Fugugent stack on the shared VPS: the environment it
reads, the GitHub secrets that drive CI/CD, how to start and stop it, the memory
budget and the reasoning behind every number in it, and what to do when the
machine starts swapping hard.

**This document assumes nothing has been run on the VPS yet.** Every command here
is for the machine's owner to run. Assumptions that could not be verified without
touching the machine are collected in [Assumptions](#assumptions) rather than
guessed at silently.

Related files:

| File | What it holds |
|---|---|
| `docker-compose.prod.yml` | The stack. Its header carries the eight decisions in long form. |
| `ai/*/app/agent/Dockerfile` | One per agent. Each header explains its build context and why the paths inside the image mirror the repository. |
| `.github/workflows/ci.yml` | All 1334 tests, plus the image build on `main`. |
| `.github/workflows/deploy.yml` | SSH deploy, gated on CI, with rollback. |
| `docs/setup/ENVIRONMENT.md` | Where each credential comes from in the first place. |

---

## 1. The machine, and why this stack is shaped the way it is

`ubuntu@<host>` — Ubuntu 24.04, **2 vCPU, 1.9 GB RAM**, 40 GB disk (14 GB free),
9.9 GB swap of which **2.9 GB is already in use**. Uptime 151 days.

**It is already running its owner's production**: a Hermes agent stack (~700 MB),
a Next.js application, `9router`, a Claude Telegram bot, and nginx serving a
`swipenit` site that proxies `:8545`, `:1317` and `:26657`. Free RAM: **813 MB**.

Every unusual choice in this deployment follows from that one fact:

- Hard memory ceilings on every service, with **no swap allowance** — the host is
  already swapping, and a stack that quietly grew into the remaining swap would
  degrade the owner's services long before anything of ours failed visibly.
- Every published port bound to `127.0.0.1`, so nothing of ours becomes newly
  reachable from the internet on a machine whose nginx belongs to someone else.
- `restart: unless-stopped`, so `docker compose stop` is final and the owner can
  reclaim memory without being fought.
- Log rotation on every service (3 × 10 MB), because a crash-looping container
  fills a shared disk faster than anything else.
- Images built in CI and only **pulled** here. Five `pnpm install` + `tsc` passes
  on 2 vCPUs and 813 MB free would at best take an age and at worst OOM something
  that is not ours.
- **Nothing here touches nginx, systemd, or any existing service.** No unit file,
  no site config, no `apt install` beyond Docker itself.

---

## 2. One-time setup on the VPS

### 2.1 Docker

Docker Engine **23 or newer** is required, for two reasons: BuildKit reads the
`Dockerfile.dockerignore` files, and `docker compose` (v2, the plugin — not the
old `docker-compose` script) is what understands `profiles:` and the `env_file`
long syntax.

```bash
docker --version           # >= 23
docker compose version     # v2.x
sudo usermod -aG docker "$USER"   # then log out and back in
```

### 2.2 Clone the repository

```bash
sudo mkdir -p /srv/fugugent && sudo chown "$USER:$USER" /srv/fugugent
git clone <repo-url> /srv/fugugent
cd /srv/fugugent
```

The absolute path chosen here is what goes into the `VPS_PATH` GitHub secret.

### 2.3 Copy the Altana session files — out of band

**These are gitignored, so `git clone` does not bring them.** They are live,
spend-capped session signers; they are not in any image and not in any commit.
From a workstation that has them:

```bash
for a in fuguguardian fugurebalancer fugugrid fuguyield; do
  ssh <user>@<host> "mkdir -p /srv/fugugent/ai/$a/.studio/wallets"
  scp ai/$a/.studio/wallets/*.json <user>@<host>:/srv/fugugent/ai/$a/.studio/wallets/
done
ssh <user>@<host> 'chmod 700 /srv/fugugent/ai/*/.studio/wallets; chmod 600 /srv/fugugent/ai/*/.studio/wallets/*.json'
```

`fuguguardian` needs **both** session files: `altana-session.json` (the
commercial ERC-8183 rail, which the boot path loads unconditionally) and
`altana-session-guardian.json` (the DeFi repay session, with its allowlist of
`MockLendingPool.repay` + `mUSD.approve`).

The containers mount `ai/<agent>/.studio/wallets` **read-only**. Nothing inside a
container has any business writing a session file.

`WALLET_PASSWORD` is deliberately **not** passed to any container. It unlocks the
admin keystore, which is only used for granting and revoking sessions — an
operator action, from a workstation, never from the running agent. The agents
carry only their bounded sessions.

> The deploy workflow uses `git reset --hard`, never `git clean`. These files are
> untracked, and `git clean -fdx` would delete them. Do not run it in this
> checkout.

### 2.4 Reserve the host ports

The ports this stack publishes sit inside Linux's default ephemeral range
(32768–60999), so an outbound connection can transiently hold one and make a
container restart fail to bind. This is the one host-level change worth making:

```bash
echo 'net.ipv4.ip_local_reserved_ports = 55432,56379,59001-59004' \
  | sudo tee /etc/sysctl.d/99-fugugent-ports.conf
sudo sysctl --system
```

---

## 3. Environment variables

Two files, both gitignored, both created by hand on the VPS. **No secret value
appears in any committed file.**

### 3.1 `/srv/fugugent/.env` — read by `docker compose` for interpolation

| Variable | Required | Default | Notes |
|---|---|---|---|
| `POSTGRES_PASSWORD` | **yes** | — | `docker compose up` refuses to start without it. The local stack's `fugugent_local_dev` default is deliberately absent here. `openssl rand -base64 32`. |
| `DGRID_API_KEY` | **yes** | — | Becomes `OPENAI_API_KEY` inside each agent (`src/model.ts` follows the `openai` provider convention but points the base URL at dGrid). Also refused if missing. |
| `POSTGRES_USER` | no | `fugugent` | |
| `POSTGRES_DB` | no | `fugugent` | |
| `REDIS_PASSWORD` | no | *(none)* | Empty means no `requirepass`. Set it — the port is loopback-only, but defence in depth is free here. |
| `RPC_URL` | no | `https://data-seed-prebsc-1-s1.bnbchain.org:8545` | **Never a `binance.org` URL.** That domain is blocked from Indonesian networks (CLAUDE.md #3), and Guardian's config loader refuses to boot on one rather than looping through timeouts that look like a healthy-but-quiet agent. |
| `IMAGE_PREFIX` | no | `fugugent` | **Written by the deploy workflow.** Do not hand-edit during normal operation. |
| `IMAGE_TAG` | no | `latest` | **Written by the deploy workflow**, to the deployed commit SHA. This is also the rollback handle. |
| `API_HOST_BIND` | no | `127.0.0.1` | Change only once an nginx vhost for `api.fugugent.xyz` exists. |
| `API_HOST_PORT` | no | `8787` | |
| `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT` | no | `55432` / `56379` | |
| `FUGUGUARDIAN_HOST_PORT` … `FUGUYIELD_HOST_PORT` | no | `59001`–`59004` | |
| `ALTANA_RELAY_URL` | no | *(SDK preset)* | |
| `SCAN8004_BASE_URL` | no | `https://api.8004scan.io/api/v1` | |
| `DGRID_BASE_URL` | no | `https://api.dgrid.ai/v1` | |

Guardian's money caps, on the **8-decimal USD basis** (`100000000` = $1.00).
Written into the compose file with these defaults so an operator can read the
numbers in force without opening TypeScript; override in `.env` to change them:

| Variable | Default | Meaning |
|---|---|---|
| `FUGU_GUARDIAN_MAX_PER_ACTION_USD8` | `1000000000` | $10.00 per repay |
| `FUGU_GUARDIAN_MAX_PER_DAY_USD8` | `5000000000` | $50.00 per day |
| `FUGU_GUARDIAN_MIN_INTERVAL_SECONDS` | `300` | Cooldown between actions |
| `FUGU_GUARDIAN_INTERVAL_MS` | `60000` | Monitoring poll interval |
| `FUGU_GUARDIAN_POOL` | *(empty)* | Empty = the address compiled into the strategy |
| `FUGU_GUARDIAN_REPAY_ASSET` | *(empty)* | Idem |

Both caps sit well under the session's own cryptographic cap of 100 mUSD/day, so
**our** limit always binds first and the chain-enforced one stays a backstop
rather than the working limit. `MAX_PER_ACTION` above `MAX_PER_DAY` is refused at
boot: it would make the per-action cap unreachable, so the number an operator
reads as "the most one repay can cost" would not be the number in force.

Minimal working file:

```bash
cat > /srv/fugugent/.env <<'EOF'
POSTGRES_PASSWORD=<openssl rand -base64 32>
REDIS_PASSWORD=<openssl rand -base64 32>
DGRID_API_KEY=<the dGrid key>
EOF
chmod 600 /srv/fugugent/.env
```

### 3.2 `/srv/fugugent/backend/.env` — read by the `api` container only

Upstream credentials come **only** from here, never from the compose
`environment:` block: `environment` wins over `env_file`, so writing them there
with an empty default would erase the keys correctly filled in in this file.

| Variable | Notes |
|---|---|
| `SCAN8004_API_KEY` | Every call to 8004scan must also carry a **browser `User-Agent`** — without one the API answers HTTP 500, not 429 (CLAUDE.md #4). Always via the backend, never from a browser. |
| `DGRID_API_KEY` | For the category classifier. |

The file is optional (`required: false`): `src/index.ts` boots without
`DATABASE_URL`, and an `/api/health` that reports a missing source is more useful
than a process that refuses to start.

---

## 4. GitHub secrets the repository owner must fill in

`Settings → Secrets and variables → Actions → New repository secret`. Nothing
below appears in any workflow file — not the host, not the path, not the key.

| Secret | Value | Why it is a secret |
|---|---|---|
| `VPS_HOST` | The VPS address. | Keeps the target out of a public workflow file. |
| `VPS_USER` | The SSH user, a member of the `docker` group. | |
| `VPS_SSH_KEY` | A **deploy-only** private key, complete PEM including the `BEGIN`/`END` lines. Generate with `ssh-keygen -t ed25519 -C fugugent-deploy -f deploy_key`, append `deploy_key.pub` to the VPS's `~/.ssh/authorized_keys`, and never reuse a personal key. | |
| `VPS_KNOWN_HOSTS` | Output of `ssh-keyscan <host>`. | Pins the host key, so the deploy cannot be induced to hand its key to whatever answers on port 22. Preferred over `StrictHostKeyChecking=no`. |
| `VPS_PATH` | The absolute checkout path, e.g. `/srv/fugugent`. | |
| `GHCR_PULL_TOKEN` | A PAT with **`read:packages` only**, so the VPS can pull private images. Omit if the GHCR packages are made public. | |

Pushing images needs no secret: CI uses the automatic per-run `GITHUB_TOKEN`.

Recommended alongside these: a branch-protection rule on `main` requiring the
**`CI gate`** check. It is a single job that fails unless every suite succeeded,
so the rule never has to enumerate a matrix that will grow.

---

## 5. Running and stopping the stack

All commands from `/srv/fugugent`.

```bash
# Start the default stack: postgres, redis, api, fuguguardian.
docker compose -f docker-compose.prod.yml up -d --no-build

# What is running, and is it healthy?
docker compose -f docker-compose.prod.yml ps

# Logs (bounded at 3 x 10 MB per service on disk).
docker compose -f docker-compose.prod.yml logs -f fuguguardian

# Live memory against the ceilings — the number to watch on this host.
docker stats --no-stream

# Stop everything. `unless-stopped` means this is FINAL: nothing comes back
# on its own, including after a reboot, until you say so.
docker compose -f docker-compose.prod.yml stop

# Stop one service to reclaim its memory.
docker compose -f docker-compose.prod.yml stop fuguguardian
```

### Bringing an advisory agent up

The three advice-only agents sit behind the `advisors` profile. See
[the memory budget](#6-the-memory-budget) for why. Bring up **one** at a time:

```bash
docker compose -f docker-compose.prod.yml up -d fugugrid    # for a demo
docker compose -f docker-compose.prod.yml stop fugugrid     # afterwards
```

All three together (`--profile advisors up -d`) needs ~1016 MB and the machine
has 813 MB free. It will swap, and swapping is what this stack is designed to
avoid.

`fuguguardian` is the one that should never be stopped: it is the one watching a
health factor.

### Removing the stack

```bash
docker compose -f docker-compose.prod.yml down            # containers + network
```

> **Never `down -v`.** The `fuguguardian-state` volume holds `ExecuteState` — the
> record of what has already been paid. See [§7](#7-guardians-state-volume).

---

## 6. The memory budget

**Total for the default stack: 536 MiB**, against a 700 MiB ceiling.

Each limit is a `mem_limit` (a cgroup ceiling — a container that reaches it is
OOM-killed) with `memswap_limit` set **equal** to it, which means *no swap
allowance at all*. That is deliberate: the host is already 2.9 GB into swap, and
a container of ours dying loudly is better than the whole machine degrading
quietly.

The agent numbers are **measured**, not estimated: each image was built and run
under the exact ceiling below, and `docker stats` was read at boot and again after
60 requests.

| Service | Limit | Why this number |
|---|---:|---|
| `postgres` | **176 MiB** | The largest single share, because it is the only service here that cannot simply be restarted out of trouble. The default `shared_buffers` of 128 MiB would alone be three quarters of the ceiling, so `command:` retunes it to 48 MiB and caps connections at 30. What remains covers WAL buffers, ~30 backend stacks and the musl allocator arenas. `max_parallel_workers_per_gather=0` because 2 vCPUs shared with someone else's production buy nothing from parallel query. |
| `redis` | **24 MiB** | A job queue and nothing else — still unused by any code, prepared for the BullMQ scheduler. `maxmemory 16mb` with `allkeys-lru` makes it **evict** rather than grow into the ceiling: for a queue, an evicted key is a rescheduled job, whereas an OOM kill is a lost worker. redis-server's own alpine baseline is ~6 MiB. |
| `api` | **112 MiB** | Node 22 + Hono + drizzle + postgres.js + viem. Measured module-graph RSS ~102 MiB on a developer machine and lower on alpine, with only ~12 MiB of live heap. V8 capped at 64 MiB so it collects instead of expanding toward the ceiling. |
| `fuguguardian` | **224 MiB** | The most of any agent, and the only one that is not advice-only: it holds a spend-capped session, runs a monitoring loop, and **broadcasts transactions**. Measured 86 MiB steady in its container — but with the loop **off**, because measuring it on means broadcasting a real testnet repay. The unmeasured part is the repay path: ABI encodings, a viem `PublicClient` and an Altana userOp on top of the steady footprint. The ceiling is ~2.6× measured idle for that reason. An OOM kill halfway through a repay is the one failure this stack must not make likely, and this is the only number here bought with judgement rather than a measurement. |
| **Default total** | **536 MiB** | 164 MiB spare against the 700 MiB budget. |
| `fugurebalancer` | 160 MiB | *(profile `advisors`)* Advice-only: reads chain state, returns a recommendation, holds no spending session, persists nothing — hence no state volume. |
| `fugugrid` | 160 MiB | *(profile `advisors`)* |
| `fuguyield` | 160 MiB | *(profile `advisors`)* |

**Why 160 and not 144 for the advisors.** Measured on `fugugrid`: **113 MiB at
boot, settling to 86 MiB** after 60 requests. Boot is the peak, because the whole
module graph resolves before V8's first real collection. At a 144 MiB ceiling that
boot peak is 78% of the limit — 31 MiB of headroom for a cold start on a host that
is already swapping. 160 MiB makes it 47 MiB. A limit that fits the steady state
but not the boot produces a container that dies and restarts forever, which is the
worst outcome available because it reads as a deploy bug rather than a capacity
problem.

**Why only Guardian starts by default.** The arithmetic does not permit more:

| Configuration | Total | Verdict |
|---|---:|---|
| Default stack | 536 MiB | Fits, 164 MiB spare |
| Default + **one** advisor | 696 MiB | Fits, 4 MiB spare |
| Default + all three | **1016 MiB** | Over the 700 MiB budget *and* over the 813 MiB free |

The cause is measured, not guessed: all four agents import
`@bnbagent/studio-runtime/b402`, which pulls in viem and the Altana SDK, so an
advice-only agent's module graph is very nearly as large as Guardian's (~196 MiB
RSS on a developer machine for the import set in `dualMain.ts`). Four Node
processes of that shape genuinely do not fit in 700 MiB beside Postgres.

Writing 64 MiB ceilings to make the table add up would have produced a stack that
boots, gets OOM-killed and restarts forever. The profile is the honest version of
the same constraint.

### Ports

Taken on the host already: **22, 80, 443, 8545, 1317, 26657, 20128.** Nothing
below collides, and everything binds to the loopback only.

| Host | → Container | Service |
|---|---|---|
| `127.0.0.1:55432` | `5432` | postgres *(the local stack's shift, preserved)* |
| `127.0.0.1:56379` | `6379` | redis *(idem)* |
| `127.0.0.1:8787` | `8787` | api *(the only one meant to be proxied)* |
| `127.0.0.1:59001` | `9000` | fuguguardian |
| `127.0.0.1:59002` | `9000` | fugurebalancer |
| `127.0.0.1:59003` | `9000` | fugugrid |
| `127.0.0.1:59004` | `9000` | fuguyield |

The agent ports continue the local stack's "prefix a 5" convention (9000 →
59000+n). Making `api` publicly reachable is an nginx change, and nginx belongs
to the machine's owner — set `API_HOST_BIND` once a vhost exists.

---

## 7. Guardian's state volume

`fuguguardian-state` (mounted at `/var/lib/fuguguardian`) holds two files:

- `guardian-state.json` — the `ExecuteState`: today's spend against the daily cap,
  the last-action timestamp behind the cooldown, the kill-switch latch, and any
  repay recorded as in-flight.
- `audit-log.jsonl` — the append-only record of what was signed.

**Losing the state file can cause a double payment.** A restarted agent with a
clean slate reads a zero daily budget and a lapsed cooldown, and can re-issue a
repay that was already broadcast. That is why it is a named volume — surviving
`docker compose down`, image replacement and reboot — and not a container path.

It is deliberately not the code's default location
(`<workspace>/.studio/guardian-state.json`), because that sits inside the same
`.studio` tree as the session key, which is mounted read-only. Secret in,
read-only; state out, read-write: two mounts, two permissions.

The kill switch is a latch inside this file, and a clean shutdown does **not**
clear it. That is intentional: a stopped Guardian must stay stopped across a
restart.

Back it up before anything destructive:

```bash
docker run --rm -v fugugent-prod_fuguguardian-state:/s -v "$PWD":/b alpine \
  tar czf /b/guardian-state-$(date +%F).tar.gz -C /s .
```

---

## 8. When the machine starts swapping hard

Symptoms: `free -h` shows swap climbing past ~4 GB, load average above 4 on 2
vCPUs, SSH turning sluggish, the owner's services slowing down.

**First, establish whether it is us.** Our containers have no swap allowance
(`memswap_limit == mem_limit`), so rising *swap* is by construction someone else's
memory — but our CPU and page-cache pressure can still be the trigger.

```bash
free -h                                   # how deep is the swap
docker stats --no-stream                  # our footprint against the ceilings
ps -eo pid,ppid,rss,comm --sort=-rss | head -20   # the whole machine, ours or not
```

Then escalate in this order — each step is smaller than the next:

1. **Stop any advisory agent.** 160 MiB each, and they are advice-only: nothing is
   lost but the ability to answer a question.
   ```bash
   docker compose -f docker-compose.prod.yml stop fugurebalancer fugugrid fuguyield
   ```

2. **Stop the api.** 112 MiB. The marketplace goes read-nothing, but Guardian
   keeps watching the health factor because it deliberately does **not**
   `depends_on` the api.
   ```bash
   docker compose -f docker-compose.prod.yml stop api
   ```

3. **Tighten Postgres further.** `shared_buffers=32MB`, `max_connections=20` in
   the `command:` block, then `up -d postgres`. Costs query performance, not data.

4. **Stop Postgres and Redis.** 200 MiB together. The api reports them as missing
   on `/api/health` rather than crashing, which is exactly what that design is
   for.

5. **Stop Guardian — last, and knowingly.** It is the agent watching a health
   factor; stopping it means no automated repay until it is back. The state file
   survives on its volume, so restarting is safe and does not double-pay.
   ```bash
   docker compose -f docker-compose.prod.yml stop fuguguardian
   ```

6. **Full stop**, if the owner needs the machine back:
   ```bash
   docker compose -f docker-compose.prod.yml stop
   ```
   `unless-stopped` means nothing returns until someone runs `up` again.

**Do not** "fix" swapping by adding more swap, raising a `mem_limit`, or removing
`memswap_limit`. Each makes our stack quieter and the host worse. The ceilings are
the mechanism that keeps a Fugugent problem from becoming the owner's problem.

If disk is the pressure rather than memory:

```bash
df -h /
docker image prune -f       # dangling layers only; keeps the previous tag on disk
docker builder prune -f
docker system df            # what is actually using the space
```

Roughly 3 GB is expected for all seven images: each agent image is 592 MB, but
all four share the `node:22-alpine` base and its layers, so the on-disk total is
well under 4 x 592 — read the real figure from `docker system df`. **Never `docker system prune -a`**
on this host: it would remove the owner's unused images too.

---

## 9. The deploy pipeline

```
push to main
  └─ CI (.github/workflows/ci.yml)
       ├─ contracts       forge test          baseline 150
       ├─ backend         vitest              baseline 484
       ├─ agents (x4)     vitest              285 / 130 / 144 / 141
       ├─ CI gate         fails unless all of the above succeeded
       └─ images          build + push to ghcr.io, tagged with the commit SHA
  └─ Deploy (.github/workflows/deploy.yml), triggered by CI's completion
       ├─ refuses unless conclusion == success and branch == main
       ├─ ssh in, record the currently live IMAGE_TAG
       ├─ git reset --hard <tested sha>      (never `git clean`)
       ├─ write IMAGE_PREFIX / IMAGE_TAG into .env
       ├─ `compose config -q` gate: a missing secret fails here, while the OLD
       │   containers are still serving
       ├─ pull, then `up -d --no-build --remove-orphans`
       ├─ wait up to 180 s for every core service to report healthy
       └─ if it does not: restore the previous tag, bring it back up, fail the job
```

**Baseline test counts are asserted, not merely observed.** A green suite is not
by itself evidence that the suite ran: a `describe` renamed to `describe.skip`, a
glob that stops matching after a file move, or a narrowed `include` all leave the
run green while testing less than yesterday. The check is `>=`, so adding tests
never breaks the build; only losing them does. When a suite legitimately shrinks,
edit the number in the same commit — the reduction should be a reviewed line in a
diff, not a silence.

**Idempotent.** Deploying the same SHA twice is a no-op: the images are present
and `up -d` recreates nothing whose config and image digest are unchanged.

**Revertible.** The live tag is recorded *before* the new one is written. If the
new containers do not become healthy, the previous tag is restored and brought
back up, and the job then fails. The rule the remote script is built around:
never leave the machine with the service down.

Deliberately absent from the deploy: `docker compose down` (it would stop
Guardian and drop the network for the length of the pull), any volume removal, and
`git clean`.

### Deploying by hand, and rolling back by hand

```bash
cd /srv/fugugent
git fetch origin && git reset --hard <sha>
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<sha>/" .env
docker compose -f docker-compose.prod.yml config -q     # gate first
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --no-build
```

To roll back, put the previous SHA in `IMAGE_TAG` and repeat. `docker image prune
-f` (without `-a`) keeps tagged images on disk, which is what makes a rollback
instant.

---

## 10. Verifying a deployment

```bash
# Every core service healthy?
docker compose -f docker-compose.prod.yml ps

# The api's own view of its dependencies. Promises never to return 5xx, so read
# the body, not the status code.
curl -s localhost:8787/api/health | jq

# Guardian's liveness contract. HEALTHY or HEALTHY_BUSY are both healthy —
# HEALTHY_BUSY means a background delivery is in flight.
curl -s localhost:59001/ping

# Is the monitoring loop actually on? Absence of this line means
# FUGU_GUARDIAN_ENABLED did not reach the container.
docker compose -f docker-compose.prod.yml logs fuguguardian | grep fugu-guardian

# The session the agent is using is still valid on-chain (no API key needed):
cast call --rpc-url https://data-seed-prebsc-1-s1.bnbchain.org:8545 \
  0x6b8361C29d05D498b1a12B54A37310f94171E94A \
  'isValidKey(address,bytes32)(bool)' \
  0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0 \
  0x7a467115cdf6d03f85f0f059733843b43cbe291d9f4489e3bf27d45e5148b377
```

Sessions expire **8 Oct 2026** (30 days from grant). An expired session stops the
agent at boot with a clear error rather than failing silently — renew with `bag
wallet session grant --force` from a workstation and re-copy the file.

---

## Assumptions

Everything below could not be settled without touching the VPS. Each is written
here rather than guessed at silently.

1. **Docker Engine ≥ 23 with the Compose v2 plugin is installed, and the deploy
   user is in the `docker` group.** Older Docker ignores the
   `Dockerfile.dockerignore` files (harmless — no `COPY` references a secret, so
   this only affects context size) but *breaks* `profiles:` and the `env_file`
   long syntax. Verify with §2.1 before the first deploy.

2. **The checkout path is `/srv/fugugent`.** Used throughout; the real value is
   whatever goes into `VPS_PATH`. The compose bind mounts are relative to the
   compose file, so any path works as long as it is consistent.

3. **The repository will be cloned on the VPS, and `.studio/wallets` populated by
   `scp`.** The deploy pulls images but still needs the compose file and the
   session files present locally.

4. **`postgres:16-alpine` runs correctly at `shared_buffers=48MB` with 176 MiB.**
   Sound by Postgres's own sizing rules, but not measured on this host — the only
   number in the budget that is not. Watch `docker stats` on the first day, and
   step 3 of §8 is the lever if it is tight.

5. **Guardian's repay path fits in 224 MiB.** Its idle footprint is measured
   (86 MiB); the repay path is not, because measuring it means broadcasting a real
   testnet transaction. The ceiling is ~2.6× idle for that reason. If Guardian is
   ever OOM-killed, this number is the first suspect — check
   `docker inspect fugugent-prod-fuguguardian | grep OOMKilled`.

6. **GHCR is the registry, and the packages may be private.** If the owner
   prefers Docker Hub or a public package, `IMAGE_PREFIX` and the
   `docker/login-action` step are the only two places to change.

7. **The `api` service is not yet publicly exposed.** No nginx vhost for
   `api.fugugent.xyz` is created by anything here — nginx belongs to the machine's
   owner. Until one exists, the api is reachable only on `127.0.0.1:8787`.

8. **No BullMQ scheduler exists yet**, so Redis is running but unused. This
   mirrors the local stack's deliberate choice, so that work need not touch
   compose again.

## Known defect: the agent lockfiles

None of the four `ai/*/pnpm-lock.yaml` files matches its
`app/agent/package.json` — `viem`, `@ai-sdk/openai` and `vitest` were added
without a `pnpm install` being committed, so `pnpm install --frozen-lockfile`
fails with `ERR_PNPM_OUTDATED_LOCKFILE`. (The sibling
`ai/*/app/agent/pnpm-lock.yaml` resolves exactly those three and nothing else, so
it is unusable too.)

CI and the four agent Dockerfiles therefore use `--no-frozen-lockfile`, which
keeps every already-locked version pinned and resolves only the three additions.
It is the smallest available deviation, but a build next month can pick up a new
minor of viem. Inside the images this is contained: the `prod-deps` stage installs
`--frozen-lockfile` against the lockfile the `build` stage just reconciled, so the
compile and the runtime share **one** resolution.

The fix is four commands and belongs to whoever owns the agents:

```bash
for a in fuguguardian fugurebalancer fugugrid fuguyield; do
  ( cd ai/$a && pnpm install --lockfile-only )
done
git add ai/*/pnpm-lock.yaml
```

Then change `--no-frozen-lockfile` back to `--frozen-lockfile` in
`.github/workflows/ci.yml` and in the four `ai/*/app/agent/Dockerfile` build
stages, and drop the `COPY --from=build /srv/agent/pnpm-lock.yaml` line from each
`prod-deps` stage.

## Live deployments (2026-09-09)

| Piece | URL / host | Notes |
|---|---|---|
| Landing page | https://landingpage-psi-umber.vercel.app | Vercel, public |
| Marketplace | https://frontend-gules-gamma-37.vercel.app | Vercel, public |
| Backend API | VPS `43.159.63.76:8787` | Not yet exposed through nginx |
| Fugu Guardian | VPS, same compose stack | Monitoring loop live against BSC testnet |

The backend runs on the VPS rather than Vercel on purpose. Its circuit breaker keeps
state in the process; on serverless every invocation starts fresh, so the breaker would
never open and the resilience the tests prove would quietly not exist in production.

Measured on the host right after `up -d`, against the pre-Docker baseline:

| | before Docker | stack running |
|---|---|---|
| RAM available | 806 MB | 679 MB |
| Swap used | 2983 MB | 3133 MB |
| 9router · claude-bot · nginx | active | active |
| Next.js :20128 | 307 | 307 |
| nginx :80 | 200 | 200 |

Container usage against its ceiling: guardian 127/224 MiB, api 40/112, postgres 30/176,
redis 5/24 — 202 MiB of the 536 MiB budget.

Still to do: expose the API through nginx with TLS, point the purchased domain at it, and
fill the six GitHub secrets listed above so the deploy workflow can run.
