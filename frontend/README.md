# manga-stream — frontend

React + TypeScript + Vite SPA for the manga-stream catalogue.

Phase 1 delivers **one real screen — the catalogue** — running either against the
mock API (MSW) or against the real API Platform backend, with no code change.

## Quick start

```bash
npm ci
cp .env.example .env.local   # optional; the defaults already work
npm run dev                  # http://localhost:5173
```

By default the app runs on **mocked data**: nothing else needs to be up.

## Scripts

| Script                 | What it does                                                  |
| ---------------------- | ------------------------------------------------------------- |
| `npm run dev`          | Dev server on `:5173` (MSW enabled by default)                 |
| `npm run build`        | Typecheck (`tsc -b`) + production build → `dist/`              |
| `npm run lint`         | `oxlint --max-warnings=0` — **fails on any warning** (CI gate) |
| `npm run typecheck`    | Full non-incremental typecheck                                 |
| `npm run generate:api` | Regenerates `src/api/schema.ts` from `../docs/openapi.yaml`    |
| `npm run preview`      | Serves the production build locally                            |

CI should run `npm ci && npm run lint && npm run build`. Both gates are green.

## Mocks (MSW)

The frontend is decoupled from the backend by [MSW](https://mswjs.io). The service
worker (`public/mockServiceWorker.js`) intercepts `/api/*` in the browser and
answers with the fixtures in `src/mocks/data.ts`.

Controlled by two env vars (see `.env.example`):

| Var              | Default | Effect                                                              |
| ---------------- | ------- | ------------------------------------------------------------------- |
| `VITE_USE_MOCKS` | `true`  | `false` sends requests to the real backend instead                   |
| `VITE_API_URL`   | `''`    | Backend base URL; empty = same origin. e.g. `http://localhost:8000`  |

To develop against the real backend:

```bash
VITE_USE_MOCKS=false VITE_API_URL=http://localhost:8000 npm run dev
```

**Mocks are dev-only.** `enableMocking()` in `src/main.tsx` is guarded by an
inline `import.meta.env.DEV` check, so Vite statically drops the dynamic import in
a production build — `msw` never ships to users (verified: the build goes from 316
to 82 modules with the guard in place).

The handlers are deliberately **contract-faithful**: same routes, same query
parameter names, same Hydra envelope, same enums as `docs/openapi.yaml`. Flipping
`VITE_USE_MOCKS` should change the data, not the behaviour.

## API contract & typed client

`docs/openapi.yaml` (owned by the backend) is the single source of truth.

```bash
npm run generate:api   # openapi-typescript ../docs/openapi.yaml -> src/api/schema.ts
```

`src/api/schema.ts` is **generated — never edit it by hand.** Regenerate it
whenever the backend publishes a new contract; any drift then shows up as a
TypeScript error instead of a runtime surprise.

`src/api/client.ts` wraps `openapi-fetch` and pins the media type:

```ts
createClient<paths, 'application/ld+json'>(...)
```

### Why JSON-LD and not plain JSON

The backend content-negotiates two formats, and the contract carries duplicated
schemas for each (`Anime.jsonld-anime.read` vs `Anime-anime.read`):

- `application/ld+json` → Hydra envelope with `member`, `totalItems`, `view.next`
- `application/json` → bare array, **no pagination metadata**

The catalogue needs pagination metadata for infinite scroll, so the app commits to
**`application/ld+json`** everywhere. Pinning it in the generic keeps `data` typed
as the Hydra shape rather than a union of both.

`src/api/hydra.ts` normalises the envelope and also tolerates the legacy
`hydra:member` / `hydra:totalItems` keys, so an API Platform vocabulary change
cannot blank the UI.

## Authentication

Phase 1 endpoints are public — the contract declares no `securitySchemes` yet.
The injection point already exists: an `openapi-fetch` middleware in
`src/api/client.ts` whose only job in phase 2 will be to read the JWT and set the
`Authorization` header. No call site will need to change.

## Contract conventions worth knowing

The API follows AniList conventions, which are not the obvious ones:

- Titles are **split**: `titleRomaji` (required), `titleEnglish`, `titleNative`.
  There is no single `title` field, and no combined title search filter.
- `averageScore` is on a **0-100** scale, not 0-10. The UI divides by 10 for display.
- `status` is an uppercase enum: `FINISHED | RELEASING | NOT_YET_RELEASED | CANCELLED | HIATUS`.
- `season` / `seasonYear` exist on **animes only**.
- Relations are IRIs (`"anime": "/api/animes/1"`), except `genres`, which the read
  serialization groups embed as full objects on collection responses.
- `Chapter.number` and `Progress.currentChapter` are `decimal(8,2)` → serialized as
  **JSON strings**, not numbers (chapters like `"12.5"`). Not used in phase 1;
  parse carefully in phase 2.
- Pagination: `?page=` + `?itemsPerPage=` (default 30, max 100).
- The collection endpoint is intentionally light; `GET /api/animes/{id}` additionally
  embeds `episodes[]`, and `GET /api/mangas/{id}` embeds `chapters[]`.

## Structure

```
src/
  api/
    schema.ts      # GENERATED from docs/openapi.yaml — do not edit
    client.ts      # openapi-fetch client, media type pinned, auth middleware hook
    hydra.ts       # Hydra envelope normalisation (member/totalItems/view.next)
    queries.ts     # React Query hooks (useCatalog, useGenres) + filter -> query params
  components/
    MediaCard.tsx  # catalogue card + loading skeleton
    FilterBar.tsx  # search, type toggle, status, season, genre chips
  hooks/
    useDebouncedValue.ts
  mocks/
    data.ts        # 20 animes / 15 mangas / 13 genres, typed against the contract
    handlers.ts    # MSW handlers reproducing API Platform's filters & pagination
    browser.ts     # worker bootstrap (dev only)
  pages/
    CatalogPage.tsx
    ComingSoon.tsx # placeholders for /anime/:id, /manga/:id, /favorites, /profile
  types/media.ts   # domain types derived from the generated schema
  config.ts        # env-driven runtime config
```

## Routes

| Route        | Phase 1 state                     |
| ------------ | --------------------------------- |
| `/`          | **Catalogue** — fully implemented |
| `/anime/:id` | placeholder                       |
| `/manga/:id` | placeholder                       |
| `/favorites` | placeholder                       |
| `/profile`   | placeholder                       |
| `*`          | 404                               |

## Notes

- **Linter**: Vite 8 scaffolds with `oxlint`, not ESLint — that is the current
  template default and it is what `npm run lint` runs. `--max-warnings=0` makes it a
  real CI gate (verified: it exits 1 on a violation).
- **No Tailwind**: a single organised `src/index.css` with CSS custom properties.

### TypeScript is pinned to 5.9, deliberately

Vite 8 scaffolds `typescript@~6.0.2`, but `openapi-typescript@7` declares a peer of
`typescript@^5.x`. That conflict makes a clean `npm ci` fail — so the project pins
**`typescript@^5.9.3`**, and the lockfile is generated with no `--force` and no
`--legacy-peer-deps`. `npm ci` exits 0 on a clean checkout.

Two settings exist *because* of that downgrade — do not remove them:

- `"strict": true` in `tsconfig.app.json` / `tsconfig.node.json`. TS 6 turns strict
  on by default; TS 5.x does not. Without the explicit flag, the downgrade would
  have silently disabled strict null checks across the whole app.
- `"DOM.Iterable"` in `lib`. The Vite 8 template omits it; TS 5.9 needs it to
  iterate `URLSearchParams` (used by the MSW handlers).

### `generate:api` only works on the host

`npm run generate:api` reads `../docs/openapi.yaml`, which sits **outside the
Docker build context** (`./frontend`). It works on the host and fails inside the
container. That is fine for now — regenerate on the host and commit
`src/api/schema.ts`. If the generation ever needs to run in Docker, the compose
build context has to be widened to the repo root.

### Base URL: the `/api` prefix is de-duplicated

The shared `docker-compose.yml` sets `VITE_API_URL=http://localhost:8000/api`,
while every path in the contract already starts with `/api`. Concatenating naively
would request `/api/api/animes`. `normalizeBaseUrl()` (`src/api/baseUrl.ts`) strips
a trailing `/api` and trailing slashes, so both conventions work. Verified against
the compose value.

### Local infra values

The backend is served by nginx on **port 8000** (not 9000). CORS allows
`localhost:5173`.

```bash
VITE_API_URL=http://localhost:8000/api
VITE_MERCURE_URL=http://localhost:3000/.well-known/mercure   # phase 2
VITE_USE_MOCKS=false                                          # to hit the real API
```

`VITE_*` values are inlined **at build time**: changing one requires restarting the
dev server.
