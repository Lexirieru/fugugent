# frontend — Fugugent marketplace

`app.hellofugu.xyz`. Next.js 16 + React 19 + Tailwind v4, run with **bun**.

```bash
bun --cwd frontend dev
bun --cwd frontend run build
bun --cwd frontend run lint
```

## The data layer — how to swap it for a real backend

Not one component calls `fetch`. Every page talks to a single interface,
`MarketplaceSource` (`src/lib/data/types.ts`), and picks its implementation
through `source()` in `src/lib/data/index.ts`:

| Implementation | File | Used when |
|---|---|---|
| `seedSource` | `src/lib/data/seed.ts` | the default — the sample data bundled with this build |
| `createHttpSource(base)` | `src/lib/data/http.ts` | as soon as `NEXT_PUBLIC_API_BASE_URL` is set |

```bash
# .env.local  (never commit this)
NEXT_PUBLIC_API_BASE_URL=https://api.hellofugu.xyz
```

The endpoints the HTTP implementation calls:

```
GET /api/agents?category=&limit=&offset=
GET /api/agents/:id
GET /api/categories
GET /api/health
```

Three things keep that swap from touching the UI:

1. **The envelope is the same as `AgentListPage` in `backend/src/types.ts`.** Failure is
   represented by `healthy: false` + `reason`, never by an exception, so a page that
   failed still has a shape and its honesty banner appears on its own.
2. **`bigint` is translated in exactly one place.** `src/lib/data/wire.ts` turns the
   decimal strings from HTTP into `bigint`, and rejects `number` for money values.
   `src/lib/money.ts` is the only place USD8 is allowed to become text.
3. **Risk, session permissions, and proof live on `AgentView`, not on `AgentRecord`.**
   The shape of `AgentRecord` is final in the backend and does not carry those three
   yet; when the backend does serve them, the only thing that changes is `toView()` in
   `http.ts`.

`src/lib/agent-types.ts` is a **mirror** of `backend/src/types.ts`. If the backend
changes, that file is the one that follows — never the other way round.

## Fugu

`src/lib/fugu.ts` is a TypeScript port of `docs/brand/generate-svg.py`, the same
generator that produced the assets in `landingpage/public/brand/`. Those static assets
exist at a single puff level only, for three of the four characters, whereas the
marketplace has to be able to draw any character x level combination. The output is an
SVG string so it can be used by a React component **and** by `ImageResponse` (the OG
image).
