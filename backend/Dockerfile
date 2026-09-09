# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# The production image for `api.fugugent.xyz`.
#
# Three decisions made deliberately this way:
#
# 1. **The build uses `tsconfig.build.json`, not `tsconfig.json`.**
#    `tsconfig.json` includes `src/**/__tests__` so that `pnpm typecheck` also
#    checks the tests. If the image compiled those too, `dist` would contain
#    files that `import` vitest — a dependency deliberately absent from the
#    production image — and the build would fail over files that are never run.
#
# 2. **Two `pnpm install` stages.** The `build` stage needs devDependencies
#    (typescript); the final stage does not. Copying the build's `node_modules`
#    into the runtime would carry tsc, vitest, and pglite into production
#    without a single one being used.
#
# 3. **No `.env` travels along.** Credentials arrive through the environment at
#    run time (see `docker-compose.yml`), never through an image layer — a layer
#    is readable by anyone who pulls the image.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# The pnpm version is pinned: `corepack enable` alone would pull "latest" and
# make an image built next month differ from one built today.
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
# pnpm 10 refuses to install when a package has an unapproved build script. The
# only one here is esbuild — transitive from vitest/tsx, used by neither `tsc`
# nor the production runtime. Approving it would mean running a binary-install
# script for something that will never be executed.
ENV PNPM_CONFIG_STRICT_DEP_BUILDS=false
WORKDIR /app

# --- build dependencies (including dev) -----------------------------------
FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm exec tsc -p tsconfig.build.json

# --- runtime dependencies only --------------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# --- the final image -------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# Runs as the unprivileged `node` user that already exists in the official image.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 8787

# The healthcheck uses the same endpoint the judges see. `/api/health` promises
# never to return 5xx — including while Postgres is down — so this container is
# considered healthy as long as the process answers, and each source's health is
# read from the response body, not from the container status.
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
