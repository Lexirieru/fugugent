# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Image produksi `api.fugugent.xyz`.
#
# Tiga keputusan yang sengaja dibuat begini:
#
# 1. **Build memakai `tsconfig.build.json`, bukan `tsconfig.json`.**
#    `tsconfig.json` menyertakan `src/**/__tests__` supaya `pnpm typecheck`
#    ikut memeriksa test. Kalau image ikut mengompilasinya, `dist` berisi
#    berkas yang meng-`import` vitest — dependensi yang sengaja tidak ada di
#    image produksi — dan build gagal karena berkas yang tidak pernah dijalankan.
#
# 2. **Dua tahap `pnpm install`.** Tahap `build` butuh devDependencies
#    (typescript); tahap akhir tidak. Menyalin `node_modules` build ke runtime
#    akan membawa tsc, vitest, dan pglite ke produksi tanpa satu pun dipakai.
#
# 3. **Tidak ada `.env` yang ikut.** Kredensial masuk lewat environment saat
#    run (lihat `docker-compose.yml`), tidak pernah lewat layer image — layer
#    bisa dibaca siapa pun yang menarik image-nya.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Versi pnpm dipatok: `corepack enable` saja akan menarik "latest" dan membuat
# image yang dibangun bulan depan tidak sama dengan yang dibangun hari ini.
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
# pnpm 10 menolak install ketika ada paket dengan build script yang tidak
# di-approve. Satu-satunya di sini adalah esbuild — transitif dari vitest/tsx,
# tidak dipakai `tsc` maupun runtime produksi. Menyetujuinya berarti
# menjalankan skrip pasang biner yang tidak akan pernah dieksekusi.
ENV PNPM_CONFIG_STRICT_DEP_BUILDS=false
WORKDIR /app

# --- dependensi build (termasuk dev) -------------------------------------
FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm exec tsc -p tsconfig.build.json

# --- dependensi runtime saja ----------------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# --- image akhir -----------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# Berjalan sebagai pengguna tak berhak `node` yang sudah ada di image resmi.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 8787

# Healthcheck memakai endpoint yang sama dengan yang dilihat juri. `/api/health`
# berjanji tidak pernah 5xx — termasuk saat Postgres mati — jadi container ini
# dianggap sehat selama proses menjawab, dan kesehatan tiap sumber dibaca dari
# badan responsnya, bukan dari status container.
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
