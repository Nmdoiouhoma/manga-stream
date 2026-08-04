# manga-stream — frontend

React + TypeScript + Vite SPA for the manga-stream catalogue.

Phase 2 delivers the full MVP — catalogue, detail sheets, JWT auth, favourites,
progress, comments and real-time notifications — running either against the mock
API (MSW) or against the real API Platform backend, with no code change.

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
| `npm test`             | Vitest, once (CI gate)                                         |
| `npm run test:watch`   | Vitest in watch mode                                           |
| `npm run test:coverage`| Vitest + V8 coverage                                           |
| `npm run typecheck`    | Full non-incremental typecheck                                 |
| `npm run generate:api` | Regenerates `src/api/schema.ts` from `../docs/openapi.yaml`    |
| `npm run preview`      | Serves the production build locally                            |

CI should run `npm ci && npm run lint && npm test && npm run build`. All three
gates are green.

### What is tested, and why those things

There is no coverage target: a percentage would be met by testing getters. The
suite covers the four places where a mistake is both easy to make and expensive
to notice.

| Fichier                       | Ce qui est ancré                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `api/baseUrl.test.ts`         | Le double `/api` — le contrat préfixe déjà ses routes, le docker-compose partagé aussi |
| `api/comments.test.ts`        | `buildThread` : fil à deux niveaux, réponse orpheline promue en racine plutôt que perdue |
| `lib/progression.test.ts`     | Normalisation `COMPLETED`, total inconnu, décimaux `decimal(8,2)` en string        |
| `components/UnitList.test.tsx`| L'épisode nu : 59 % des 4 392 épisodes en base n'ont qu'un numéro                  |
| `pages/ListPage.test.tsx`     | « Ma liste » : onglets, tri, `+1`, relecture de la réponse serveur, rollback sur 422 |

`src/test/http.ts` remplace `globalThis.fetch` **depuis `setupFiles`**, et non
via un `vi.spyOn` dans le corps d'un test : `openapi-fetch` capture la fonction
à la création du client (`fetch: baseFetch = globalThis.fetch`), donc un espion
posé plus tard n'intercepte rien et la requête part pour de vrai. Par défaut
toute requête non simulée **lève** — un test qui oublie un mock casse au lieu
de dépendre du réseau.

## Mocks (MSW)

The frontend is decoupled from the backend by [MSW](https://mswjs.io). The service
worker (`public/mockServiceWorker.js`) intercepts `/api/*` in the browser and
answers with the fixtures in `src/mocks/data.ts`.

**Le worker n'est jamais publié.** `public/mockServiceWorker.js` était copié
dans `dist/` et donc **servi en production** (200 `application/javascript`,
constaté sur l'instance déployée). Un plugin de `vite.config.ts` le retire
maintenant du bundle : tant que ce script répond 200, un Service Worker installé
du temps de `VITE_USE_MOCKS=true` reste installé, alors qu'un 404 pousse le
navigateur à le désinstaller.

**Et les workers déjà installés sont purgés.** Retirer le fichier du build ne
désinstalle rien de ce qui existe déjà. Au démarrage, mocks éteints,
`main.tsx` désenregistre tout Service Worker dont le script est
`mockServiceWorker.js`, puis recharge **une fois** la page si elle était
contrôlée — `unregister()` seul laisse la page courante sous le contrôle du
worker jusqu'à sa prochaine navigation.

Controlled by two env vars (see `.env.example`):

| Var              | Default | Effect                                                              |
| ---------------- | ------- | ------------------------------------------------------------------- |
| `VITE_USE_MOCKS`      | `true`  | `false` sends requests to the real backend instead                  |
| `VITE_API_URL`        | `''`    | Backend base URL; empty = same origin. e.g. `http://localhost:8000` |
| `VITE_MERCURE_URL`    | `''`    | Mercure hub for SSE; empty disables real-time entirely              |
| `VITE_MERCURE_TOPICS` | *(defaults)* | Comma-separated topics; `{origin}`, `{userIri}`, `{userId}`    |

### Signing in against the mocks

MSW ships a demo account — anything else is rejected with a 401, exactly as the
real backend would:

```
demo@manga-stream.test / demo1234
```

Registration works against the mocks too, and the created account persists for the
lifetime of the tab.

To develop against the real backend:

```bash
VITE_USE_MOCKS=false VITE_API_URL=http://localhost:8000/api npm run dev
```

The docker-compose `frontend` service already runs with those values, mounting this
directory — so `http://localhost:5173` is this code against the real backend.

**Mocks are dev-only.** `enableMocking()` in `src/main.tsx` is guarded by an
inline `import.meta.env.DEV` check, so Vite statically drops the dynamic import in
a production build — `msw` never ships to users (verified: the build goes from 316
to 103 modules with the guard in place — the production bundle contains no `msw`
string at all).

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

The contract declares `securitySchemes.JWT` (HTTP bearer) and three operations:

| Operation           | Used by                                            |
| ------------------- | -------------------------------------------------- |
| `POST /api/login`    | `login()` — `{ email, password }` ⇒ `{ token }`    |
| `POST /api/register` | `register()` — then chains a login (no combined op) |
| `GET  /api/me`       | resolves the current user after every login         |

The JWT never appears at a call site. A single `openapi-fetch` middleware in
`src/api/client.ts` injects `Authorization: Bearer …` on every request and turns a
401 into a clean logout.

### `POST /api/login` uses a second client

`apiClient` is pinned to `application/ld+json`, but the login operation declares
`application/json` **only** — asking the pinned client for it yields `never`. Hence
`jsonApiClient`, pinned to plain JSON. It also carries **no auth middleware**, on
purpose: a wrong password is a 401 too, and it must never trigger the global
"session expired" logout.

### Not looping on a 401

Three guards, because an expired token otherwise produces a logout storm:

1. **Before sending** — a token whose `exp` has passed is dropped locally; the
   request goes out anonymous rather than generating a 401.
2. **On response** — only a request that actually carried an `Authorization`
   header counts, and `/api/login` + `/api/register` are excluded outright.
3. **`notifyUnauthorized()` is idempotent** — it clears the session *before*
   notifying and no-ops when there is none. Ten parallel 401s ⇒ one logout, one
   redirect.

React Query is also configured never to retry a 4xx (`shouldRetry` in `main.tsx`)
and never to retry a mutation.

### Storing the JWT in `localStorage` — the trade-off, stated plainly

The token is persisted in `localStorage` (`src/auth/session.ts`) so a page refresh
does not sign the user out.

**This is not the secure option, and it is a deliberate MVP compromise.**
`localStorage` is readable by any JavaScript running on the origin: a single XSS —
a vulnerable dependency, an unescaped user string rendered as HTML, a compromised
CDN script — is enough to exfiltrate the token and let an attacker impersonate the
user until it expires (currently 1 hour).

The XSS-resistant alternative is for the backend to issue an **httpOnly, Secure,
SameSite=Strict cookie**: JavaScript cannot read it, so an XSS can no longer steal
the credential (it would still need CSRF protection, and CORS would have to allow
credentials). That requires backend work this phase does not have.

What limits the blast radius today:

- React escapes interpolated content by default, and the app never uses
  `dangerouslySetInnerHTML` — the usual XSS route is closed.
- Tokens are short-lived (1 h) and expiry is enforced client-side *and* server-side.
- The session is dropped on any 401, so a revoked token stops working immediately.

**If this app ever handles anything more sensitive than a watchlist, move the token
to an httpOnly cookie before shipping.**

## Contract conventions worth knowing

The API follows AniList conventions, which are not the obvious ones:

- Titles are **split**: `titleRomaji` (required), `titleEnglish`, `titleNative`.
  There is no single `title` *field*, but there **is** a combined `?title=` search
  **filter** (custom, ORs the three columns). That is what the catalogue search box
  uses — searching `titleRomaji` alone would miss every English-only match, since
  API Platform ANDs distinct filters together.
- `averageScore` is on a **0-100** scale, not 0-10. The UI divides by 10 for display.
- `status` is an uppercase enum: `FINISHED | RELEASING | NOT_YET_RELEASED | CANCELLED | HIATUS`.
- `season` / `seasonYear` exist on **animes only**.
- Relations are IRIs (`"anime": "/api/animes/1"`), except `genres`, which the read
  serialization groups embed as full objects on collection responses.
- `Chapter.number` and `Progress.currentChapter` are `decimal(8,2)` → serialized as
  **JSON strings**, not numbers (`"12.50"`). Everything reading them goes through
  `parseDecimal()`, everything writing them sends `toFixed(2)`. Half-chapters are
  the entire reason the column is a decimal, so rounding is not acceptable.
  Verified round-tripping `"99.50"` through the real backend unchanged.
- `GET /api/me` answers with `"@id": "/api/me"` — the **operation** IRI, not
  `/api/users/{id}`. The resource IRI is rebuilt from `id` (`canonicalUserIri`),
  because that is what `Favorite.user` / `Progress.user` / `Comment.user` reference.
- Pagination: `?page=` + `?itemsPerPage=` (default 30, max 100).
- The collection endpoint is intentionally light; `GET /api/animes/{id}` additionally
  embeds `episodes[]`, and `GET /api/mangas/{id}` embeds `chapters[]`.

## Real-time notifications (Mercure)

The bell subscribes to the Mercure hub over SSE (`src/hooks/useMercure.ts`) and
invalidates the notifications query on any push. **It is strictly a bonus**: with no
hub, no subscriber token, or an unreachable hub, the bell still works — it refreshes
when opened. The panel shows the connection state.

`EventSource` reconnects natively every ~3 s, forever, with no backoff. Against a
dead hub that is a request every 3 s for as long as the tab is open, so the hook
takes over: it `close()`s on the first error and drives reconnection itself with
**exponential backoff + jitter (1 s → 30 s)**, gives up after 6 consecutive
failures (`status: 'unavailable'`, one `console.warn`, not one per attempt), and
pauses entirely while the tab is hidden.

### The chain, end to end

The hub runs with `MERCURE_ALLOW_ANONYMOUS=false`: every subscriber must present a
JWT whose `mercure.subscribe` claim lists the topics it may read. **The frontend does
not mint that token** — it could not without holding the HS256 secret. The backend
issues it, scoped to one topic:

```
POST /api/login  ->  { "token": "<API JWT>",
                       "mercure": { "hubUrl": "…", "topic": "/api/users/16/notifications",
                                    "token": "<subscriber JWT>" } }
GET  /api/mercure/subscription  ->  the same object, for renewal
```

The subscriber JWT expires independently of the API JWT, so `useNotificationStream`
refreshes it on a timer derived from its own `exp` (not a fixed interval): waking up
*after* the hub cut the connection would lose events.

**Topic convention** — `/api/users/{id}/notifications`, frozen by the backend in
`App\Service\Notification\NotificationTopics`. One topic per user, no generic
channel, and every update published `private: true`. That last part is the load-bearing
one: a *public* update is broadcast to every subscriber of the topic whatever their
JWT says, so restricting subscriptions alone would cloister nothing.

When a subscription is available the topic comes from the backend — it is then
consistent by construction with the token's claim. `mercureTopicsFor()` in
`config.ts` is only the fallback, and it still refuses any topic not scoped by
`{userIri}`/`{userId}` (the phase-2 catch-all topic was removed and must not come back).

### Handing the token to `EventSource`

`EventSource` accepts no headers, so `Authorization: Bearer` is out. Two options,
which are not equivalent:

1. **cookie `mercureAuthorization`** + `withCredentials: true` — the recommended
   route, and what the infra wired (the hub answers
   `Access-Control-Allow-Credentials: true` for `http://localhost:5173`). The token
   appears in no URL and no access log. A JS-set cookie only reaches hosts on the
   same *site*; ports do not count, so `localhost:5173` → `localhost:3000` works.
2. **`?authorization=<jwt>`** — accepted by the hub, used **only** when the hub is on
   another site and the cookie cannot reach it. It puts a bearer token in a URL:
   proxy logs, history, `Referer`. Setting the cookie from the backend via
   `Set-Cookie` would be the real fix for that deployment shape.

The cookie is cleared on logout and on session expiry — it is a bearer token.

### Le fil de commentaires suit la cloche

Être prévenu d'une réponse qu'on ne voit pas est absurde : la cloche
s'incrémentait pendant que le fil restait figé jusqu'au rechargement. Un
événement `COMMENT_REPLY` invalide donc aussi `['comments']`. Le préfixe seul,
sans l'œuvre : le payload porte le commentaire et son parent, **jamais** l'IRI
du média — cibler précisément demanderait de l'ajouter côté backend. Le coût
est nul, React Query ne refetchant que les requêtes *actives*.

### Publier un commentaire : ce qui a été trouvé, et ce qui ne l'a pas été

Symptôme rapporté (tâche #22) : un commentaire racine n'apparaissait qu'après
rechargement.

Ce qui a été **vérifié contre l'API déployée** : `POST /api/comments` répond
201 avec le corps complet, et la requête *exacte* du front
(`?anime=…&itemsPerPage=100&order[createdAt]=desc`) le voit immédiatement. Le
chemin serveur est sain ; la cause est côté navigateur.

Ce qui a été **corrigé** : `useAddComment` fait désormais une mise à jour
optimiste avec rollback, comme `useDeleteComment` en avait déjà une. Le
commentaire est à l'écran au clic, quelle que soit la cause du symptôme.

Ce qui **n'est pas** la cause, contrairement à l'hypothèse de départ : le
Service Worker MSW fantôme. Son code passe les requêtes en `passthrough` tant
qu'aucun client ne s'est annoncé (`if (activeClientIds.size === 0) return`), et
aucun client ne s'annonce mocks éteints. Il est purgé quand même — c'est de
l'hygiène, et publier un worker de mock en production n'a aucune justification
— mais il n'explique pas le symptôme. La cause exacte reste **non établie**.

### Verified, not assumed

Phase 2 only proved the transport with a self-forged token. This was checked against
the running stack on 2026-08-02:

- subscribed with the **backend-issued** token, had a second account reply to a
  comment, and received the `COMMENT_REPLY` notification — an event actually
  published by the backend;
- counter-test: account B's token, subscribing to A's topic, receives **nothing**.

## Structure

```
src/
  api/
    schema.ts      # GENERATED from docs/openapi.yaml — do not edit
    client.ts      # openapi-fetch clients, media types pinned, auth middleware
    auth.ts        # login / register / me
    hydra.ts       # Hydra envelope normalisation (member/totalItems/view.next)
    queries.ts     # catalogue + detail hooks, filters -> query params
    favorites.ts   # favourites, optimistic toggle with rollback
    progress.ts    # watch/read progress (decimal chapter handling lives here)
    comments.ts    # thread rebuilt client-side from `parent`
    notifications.ts
    recommendations.ts # suggestions + defensive `reason` parsing
    mercure.ts     # subscriber token: read, renew, hand to EventSource
  auth/
    session.ts     # framework-free session store (localStorage, JWT decode, 401 guard)
    context.ts     # context object + value type (kept apart for fast refresh)
    AuthContext.tsx / useAuth.ts / RequireAuth.tsx
  components/
    MediaCard.tsx · FilterBar.tsx · FavoriteButton.tsx · WatchlistButton.tsx
    ProgressPanel.tsx · CommentThread.tsx · NotificationBell.tsx
    UnitList.tsx   # episodes/chapters: chunking + missing-data fallbacks
    RecommendationCard.tsx
  hooks/
    useDebouncedValue.ts · useMercure.ts · useNotificationStream.ts
  lib/
    externalUrl.ts · retryAfter.ts
    progression.ts # règles de progression, sans React donc testables directement
  mocks/
    data.ts        # catalogue fixtures, typed against the contract
    db.ts          # mutable store: users, favourites, progress, comments, notifications
    handlers.ts    # MSW handlers reproducing filters, pagination, auth and status codes
    browser.ts     # worker bootstrap (dev only)
  pages/
    CatalogPage · MediaDetailPage · LoginPage · RegisterPage
    ListPage       # « Ma liste » : onglets par statut, +1, tri, édition rapide
    FavoritesPage · RecommendationsPage · ProfilePage · NotFoundPage
  test/
    setup.ts       # matchers jest-dom, garde réseau, cleanup entre tests
    http.ts        # remplacement de `fetch`, installé avant tout import applicatif
  types/media.ts   # domain types derived from the generated schema
  config.ts        # env-driven runtime config
```

## Routes

| Route         | State                                                          |
| ------------- | -------------------------------------------------------------- |
| `/`           | Catalogue — filters live in the query string (shareable)        |
| `/anime/:id`  | Detail sheet: banner, titles, synopsis, genres, episodes        |
| `/manga/:id`  | Detail sheet: same, with chapters                               |
| `/login`      | public                                                          |
| `/register`   | public                                                          |
| `/list`       | **protected** — « Ma liste » : onglets par statut, `+1` en accès direct |
| `/favorites`  | **protected** (`RequireAuth`)                                   |
| `/recommendations` | **protected** — suggestions ranked by score, with the reason spelled out |
| `/profile`    | **protected** (`RequireAuth`)                                   |
| `*`           | 404                                                             |

`/list` garde son état dans l'URL (`?statut=WATCHING&type=anime&tri=title`),
comme le catalogue : un onglet est partageable et le retour arrière du
navigateur fait ce qu'on attend après un clic d'onglet.

Genre chips on a detail sheet link back to `/?genre=<slug>`; the catalogue reads
its filters from the URL, so no shared store is involved and the link is shareable.

## Known backend gaps (verified against the running API, 2026-08-02)

**Backend** issues the frontend works around. Remove the workaround when the row
is fixed.

| Still open | Frontend workaround |
| ---------- | ------------------- |
| `Comment.parent` is typed as a nested write object instead of `format: iri-reference`, unlike every other relation | posts an IRI and overrides the type locally — the API accepts it |
| `POST /api/login` documents only a `200` response (no 401/400), so `openapi-fetch` types `error` as `never` | reads the status off `Response` directly |
| `GET /api/me` answers `"@id": "/api/me"` (operation IRI, not resource IRI) | `canonicalUserIri()` rebuilds `/api/users/{id}` from `id` |
| Episodes and chapters are not imported by the AniList sync — every media has `episodes: []` / `chapters: []` | the lists render an explicit "N announced, none referenced yet" message |
| Nothing is published to Mercure (no `HubInterface`, no `mercure: true` on any resource) | the SSE layer degrades silently; the bell falls back to refresh-on-open |

Fixed by the backend during phase 2, workaround kept as a safety net:

| Was | Now |
| --- | --- |
| A duplicate favourite returned **500** with a raw `SQLSTATE[23505]` message and a stack trace | clean **422**, `user: Cet anime est déjà dans vos favoris.` — `unwrap()`'s sanitiser still guards against any other DB leak |
| `Notification.isRead` was **never serialised**, though the contract declared it required and the value *was* stored (`?isRead=` filtered on it correctly). Every notification therefore read as unread forever, and "mark as read" was undone by the next refetch. | serialised again. `useNotifications` still issues a second `?isRead=false` query and falls back to set membership **only when the field is absent** — the field always wins when present. Cheap safety net; delete both the second query and the `typeof … === 'boolean'` branch in `toEntry` once the fix is committed and stable. |

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
`localhost:5173`, and so does the Mercure hub — a dev server on any other port
(5174 for instance, when 5173 is taken by the container) will have its SSE
connection blocked by CORS and degrade to refresh-on-open.

```bash
VITE_API_URL=http://localhost:8000/api
VITE_MERCURE_URL=http://localhost:3000/.well-known/mercure
VITE_USE_MOCKS=false                                          # to hit the real API
```

`VITE_*` values are inlined **at build time**: changing one requires restarting the
dev server.
