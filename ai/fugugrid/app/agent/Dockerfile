# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# fugugrid — an ADVICE-ONLY agent. It recommends grid levels and the next grid action from slot0(); the owner executes.
#
# It reads chain state and returns a recommendation. It holds no session key it
# ever spends through, it broadcasts no transaction, and it persists nothing it
# would be dangerous to lose. That single fact is what separates this Dockerfile
# from `ai/fuguguardian/app/agent/Dockerfile`: no state volume, and a smaller
# memory ceiling. Compare the two before changing either.
#
# ## The build context is the workspace root, NOT this directory
#
#     docker build -f app/agent/Dockerfile ai/fugugrid
#     # or, from docker-compose.prod.yml:
#     #   context: ./ai/fugugrid
#     #   dockerfile: app/agent/Dockerfile
#
# `app/agent/pnpm-lock.yaml` exists but resolves only three of the nine runtime
# dependencies, so `pnpm install --frozen-lockfile` inside this directory fails
# outright. The workspace lockfile at `../../pnpm-lock.yaml` is the one whose
# `importers:` block covers `app/agent` — hence the wider context. It is not
# clean either; see the ⚠️ block on the `build` stage for exactly how, and for the
# one command that fixes it permanently.
#
# A consequence worth knowing: `.dockerignore` in THIS directory is not the file
# Docker reads for that context. BuildKit reads
# `app/agent/Dockerfile.dockerignore` (a Dockerfile-adjacent ignore file), which
# is committed next to this one. Both are present so the exclusions hold
# whichever way the image gets built.
#
# ## Why the paths inside the image mirror the repository
#
# The runtime resolves its configuration by walking up from `process.cwd()` for
# `studio.toml`, then resolves `[wallet].keystore_dir` / `[wallet].session_file`
# — both written `../../.studio/wallets/...` — RELATIVE to the directory holding
# `studio.toml`. The image therefore places the agent at `/srv/agent/app/agent`,
# making `/srv/agent` the workspace root, so `../../.studio/wallets` resolves to
# `/srv/agent/.studio/wallets` — exactly where docker-compose.prod.yml
# bind-mounts the host session directory read-only. Flattening this to `/app`
# would send the runtime looking for `/.studio/wallets`.
#
# ## Why a compiled `dist`, not `tsx`
#
# `package.json` has no `start` script — only `dev: tsx src/dualMain.ts`. Running
# tsx in production would ship tsx + esbuild and the devDependency tree behind
# them, and pay an esbuild transform on every cold start. On a 1.9 GB box shared
# with someone else's production the deciding factor is memory: `tsc` is a
# build-stage cost, tsx is a permanent resident one. `build: tsc -p
# tsconfig.json` is verified to compile this package cleanly, so the runtime
# stage carries production dependencies and plain `.js` only.
#
# `tsconfig.json` sets `include: ["src"]`, sweeping in `src/__tests__`, whose
# files `import` vitest — a devDependency deliberately absent from the runtime
# image. Rather than edit the checked-in tsconfig (shared with `pnpm typecheck`,
# which SHOULD check the tests), the build writes a throwaway
# `tsconfig.docker.json` that extends it and excludes only that directory — the
# same separation `backend/Dockerfile` gets from `tsconfig.build.json`.
#
# ## The session key never enters a layer
#
# `.studio/wallets/altana-session.json` is a live, spend-capped session signer
# for the commercial ERC-8183 rail. It is gitignored, it is NOT copied by any
# instruction below, and it is not reachable from this build context. It arrives
# at run time as a read-only bind mount. An image layer is readable by anyone who
# can pull the image; a session key must never be in one.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Pinned to the `packageManager` field of the workspace package.json. `corepack
# enable` on its own resolves "latest", which makes an image built next month
# differ from one built today for no recorded reason.
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
# pnpm refuses to install while a package has an unapproved lifecycle script. The
# only one in this tree is esbuild (transitive via tsx/vitest — devDependencies,
# so absent from the production install entirely). The workspace's `allowBuilds:`
# key is honoured by newer pnpm than this pin, so the guard is switched off
# explicitly, matching backend/Dockerfile.
ENV PNPM_CONFIG_STRICT_DEP_BUILDS=false
WORKDIR /srv/agent

# --- compile ---------------------------------------------------------------
FROM base AS build
# Manifests first: this layer is the expensive one and it should only be
# invalidated by a dependency change, never by a source edit.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY app/agent/package.json ./app/agent/
#
# `--frozen-lockfile`. The committed `pnpm-lock.yaml` matches
# `app/agent/package.json`, so the build gets one exact resolution and cannot pick
# up a new minor of anything.
#
# It was `--no-frozen-lockfile` for a while, because three specifiers (`viem`,
# `@ai-sdk/openai`, `vitest`) had been added to package.json without a
# `pnpm install` being committed. That was not free: resolving fresh on every run
# is how CI ended up failing on a missing `@rolldown/binding-wasm32-wasi`, a
# platform-specific optional dependency that a stale lockfile does not record.
# Regenerating the lockfile (`pnpm install --lockfile-only`) fixed both at once.
RUN --mount=type=cache,id=pnpm-fugugrid,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY app/agent/tsconfig.json ./app/agent/
COPY app/agent/src ./app/agent/src
WORKDIR /srv/agent/app/agent
RUN printf '%s' '{"extends":"./tsconfig.json","exclude":["src/__tests__"]}' \
      > tsconfig.docker.json \
 && pnpm exec tsc -p tsconfig.docker.json

# --- production dependencies only -----------------------------------------
# A separate stage rather than pruning the build stage: copying the build's
# node_modules forward would carry typescript, tsx, vitest and esbuild into the
# runtime image, none of which is ever executed there. (`pnpm prune --prod` is not
# an option in a Dockerfile — it refuses to remove a modules directory without a
# TTY: ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY.)
FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml ./
COPY app/agent/package.json ./app/agent/
# The same committed lockfile the build stage used, so the compile and the runtime
# install share one resolution and the agent cannot end up running against
# different dependency versions than it was compiled against.
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-fugugrid,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# --- the final image -------------------------------------------------------
FROM node:22-alpine AS runtime

# `/srv/agent` is the workspace root and `/srv/agent/app/agent` the project root
# — see the header. Both node_modules trees are copied to the SAME absolute paths
# they had in prod-deps, because pnpm links `app/agent/node_modules/<pkg>` to
# `../../node_modules/.pnpm/<pkg>/...` with relative symlinks. Moving either tree
# breaks every one of them.
COPY --from=prod-deps --chown=node:node /srv/agent/node_modules /srv/agent/node_modules
COPY --from=prod-deps --chown=node:node /srv/agent/app/agent/node_modules /srv/agent/app/agent/node_modules
COPY --from=build --chown=node:node /srv/agent/app/agent/dist /srv/agent/app/agent/dist
# studio.toml is runtime configuration, not build input: the wallet kind, the
# network, the dGrid base URL and the ERC-8183 price are read from it on every
# boot. It carries no secret — only the $U token address and the agent's own
# public admin address.
COPY --chown=node:node app/agent/package.json app/agent/studio.toml /srv/agent/app/agent/

WORKDIR /srv/agent/app/agent
ENV NODE_ENV=production
# AGENT_PORT, not PORT: dualMain.ts reads AGENT_PORT and defaults to 9000, and
# its comment is explicit that the AgentCore A2A contract is 0.0.0.0:9000 and
# that the HTTP `$PORT=8080` convention must not be honoured here.
ENV AGENT_PORT=9000
ENV AGENT_BIND_HOST=0.0.0.0
# V8 sizes its heap from the machine's total RAM, not from the container's cgroup
# limit. Left alone it would grow past the 160 MiB ceiling in
# docker-compose.prod.yml and be OOM-killed rather than collecting. Measured in
# this container: 113 MiB RSS at boot, settling to 86 MiB after 60 requests — the
# 96 MiB cap is what keeps the boot peak from climbing further. This is LOWER
# than fuguguardian's 128 MiB on purpose: this agent answers a question and
# returns, it does not carry a monitoring loop and an in-flight userOp.
ENV NODE_OPTIONS=--max-old-space-size=96

# The append-only audit log of what this agent signed. Advice-only, so what it
# signs is quotes and deliveries, not spends — worth keeping for a session,
# not worth a named volume. It stays in the container layer and goes away with
# the container; `docker compose logs` is the durable copy.
ENV STUDIO_AUDIT_LOG_PATH=/tmp/audit-log.jsonl

# The unprivileged `node` user already exists in the official image. It must own
# the project directory: studio.toml is read on every boot and the runtime
# `mkdirSync`s its own log parents.
RUN chown -R node:node /srv/agent
USER node
EXPOSE 9000

# `GET /ping` is the liveness contract dualMain.ts implements, answering
# `{"status":"HEALTHY"}` or `HEALTHY_BUSY` while a background delivery is in
# flight. Both are healthy — only a process that fails to answer is not.
# start-period is generous because the boot path loads the Altana session and
# verifies it against the on-chain Keystore over a public testnet RPC, refusing
# to start on a configuration fault rather than logging one.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.AGENT_PORT||9000)+'/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No npm/pnpm wrapper: a `pnpm dev` parent would swallow SIGTERM, and
# dualMain.ts installs SIGINT/SIGTERM handlers. Exec'ing node as PID 1 is what
# lets those handlers fire on `docker compose stop`.
CMD ["node", "dist/dualMain.js"]
