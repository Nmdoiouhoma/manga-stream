/**
 * MSW request handlers standing in for the API Platform 4 backend.
 *
 * These are aligned on the real contract (`docs/openapi.yaml`): same routes,
 * same query-parameter names, same JSON-LD/Hydra envelope, same enums, same
 * status codes. The goal is that flipping `VITE_USE_MOCKS` changes nothing but
 * the data.
 *
 * Implemented per the contract:
 *   - `?page` / `?itemsPerPage` (default 30, max 100)
 *   - `?title` — the combined OR search across the three title columns
 *   - partial search on `titleRomaji` / `titleEnglish` / `titleNative`
 *   - exact filters on `status`, `season`, `seasonYear`, `genres.slug`
 *     (each accepts the scalar form and the repeated `[]` form, OR-ed)
 *   - `order[...]=asc|desc`
 *   - JWT auth: `POST /api/login`, `POST /api/register`, `GET /api/me`
 *   - the user-scoped collections: favorites, progress, comments, notifications
 *
 * ⚠️ Auth is *simulated*: the token is a structurally valid unsigned JWT so
 * that `decodeJwt` / `isTokenExpired` run exactly the same code path as against
 * the real backend, but nothing verifies it. This is a fixture, not a security
 * model.
 */
import { http, HttpResponse, delay } from 'msw'
import { animes, mangas, genres } from './data'
import {
  chaptersFor,
  comments,
  createUser,
  episodesFor,
  favorites,
  findUserByEmail,
  findUserByIri,
  mediaRefFor,
  notifications,
  passwords,
  progress,
  seedNotifications,
  takeId,
  users,
  type MockComment,
  type MockFavorite,
  type MockNotification,
  type MockProgress,
} from './db'
import type { Anime, Genre, Manga } from '../types/media'

/** The contract documents a default page size of 30 and a maximum of 100. */
const DEFAULT_ITEMS_PER_PAGE = 30
const MAX_ITEMS_PER_PAGE = 100
const LD_JSON = { 'Content-Type': 'application/ld+json; charset=utf-8' }

type MediaResource = Anime | Manga

/** Reads a filter that API Platform accepts both as `x=` and as repeated `x[]=`. */
function multiParam(search: URLSearchParams, name: string): string[] {
  return [...search.getAll(name), ...search.getAll(`${name}[]`)].filter(Boolean)
}

/** Builds the Hydra `view` (PartialCollectionView) for a paginated collection. */
function buildView(basePath: string, search: URLSearchParams, page: number, lastPage: number) {
  const withPage = (target: number) => {
    const params = new URLSearchParams(search)
    params.set('page', String(target))
    return `${basePath}?${params.toString()}`
  }

  return {
    '@id': withPage(page),
    '@type': 'PartialCollectionView',
    first: withPage(1),
    last: withPage(Math.max(lastPage, 1)),
    ...(page > 1 ? { previous: withPage(page - 1) } : {}),
    ...(page < lastPage ? { next: withPage(page + 1) } : {}),
  }
}

/** Applies the media filters declared in the contract. */
function applyFilters<T extends MediaResource>(collection: T[], search: URLSearchParams): T[] {
  // SearchFilter: partial, case-insensitive.
  const partial = (value: string | null | undefined, needle: string) =>
    (value ?? '').toLowerCase().includes(needle.toLowerCase())

  const titleRomaji = search.get('titleRomaji')
  const titleEnglish = search.get('titleEnglish')
  const titleNative = search.get('titleNative')
  /** The backend's custom combined filter: OR across the three title columns. */
  const title = search.get('title')

  const statuses = multiParam(search, 'status')
  const seasons = multiParam(search, 'season')
  const seasonYears = multiParam(search, 'seasonYear')
  // The contract exposes both `genres` (IRI) and `genres.slug` (exact slug).
  const genreSlugs = multiParam(search, 'genres.slug')

  let result = collection.filter((item) => {
    if (titleRomaji && !partial(item.titleRomaji, titleRomaji)) return false
    if (titleEnglish && !partial(item.titleEnglish, titleEnglish)) return false
    if (titleNative && !partial(item.titleNative, titleNative)) return false

    if (
      title &&
      !(
        partial(item.titleRomaji, title) ||
        partial(item.titleEnglish, title) ||
        partial(item.titleNative, title)
      )
    ) {
      return false
    }

    // Repeated values of the same filter are OR-ed by API Platform;
    // different filters are AND-ed. Reproduced faithfully here.
    if (statuses.length > 0 && !statuses.includes(item.status ?? '')) return false

    if (seasons.length > 0) {
      const season = 'season' in item ? (item.season ?? '') : ''
      if (!seasons.includes(season)) return false
    }
    if (seasonYears.length > 0) {
      const year = 'seasonYear' in item ? String(item.seasonYear ?? '') : ''
      if (!seasonYears.includes(year)) return false
    }

    if (genreSlugs.length > 0) {
      const slugs = (item.genres ?? []).map((genre) => genre.slug)
      if (!genreSlugs.some((slug) => slugs.includes(slug))) return false
    }

    return true
  })

  // OrderFilter — `order[field]=asc|desc`.
  for (const [key, direction] of search.entries()) {
    const match = /^order\[(.+)]$/.exec(key)
    if (!match) continue
    const field = match[1] as keyof T
    const sign = direction === 'desc' ? -1 : 1
    result = [...result].sort((a, b) => {
      const av = a[field] as unknown
      const bv = b[field] as unknown
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign
      return String(av ?? '').localeCompare(String(bv ?? '')) * sign
    })
  }

  return result
}

/** Wraps a filtered collection into the paginated Hydra envelope. */
function hydraCollection<T>(request: Request, basePath: string, contextName: string, all: T[]) {
  const search = new URL(request.url).searchParams
  const page = Math.max(Number(search.get('page') ?? '1') || 1, 1)
  const itemsPerPage = Math.min(
    Math.max(
      Number(search.get('itemsPerPage') ?? DEFAULT_ITEMS_PER_PAGE) || DEFAULT_ITEMS_PER_PAGE,
      1,
    ),
    MAX_ITEMS_PER_PAGE,
  )
  const offset = (page - 1) * itemsPerPage
  const member = all.slice(offset, offset + itemsPerPage)
  const lastPage = Math.ceil(all.length / itemsPerPage)

  return HttpResponse.json(
    {
      '@context': `/api/contexts/${contextName}`,
      '@id': basePath,
      '@type': 'Collection',
      totalItems: all.length,
      member,
      // Tolerance: anything still reading the prefixed Hydra vocabulary works too.
      'hydra:member': member,
      'hydra:totalItems': all.length,
      view: buildView(basePath, search, page, lastPage),
    },
    { headers: LD_JSON },
  )
}

/** API Platform returns RFC 7807 style errors under the Hydra context. */
function problem(status: number, detail: string, id = '/api/errors') {
  return HttpResponse.json(
    { '@id': id, '@type': 'hydra:Error', title: 'An error occurred', detail, status },
    { status, headers: LD_JSON },
  )
}

const notFound = (basePath: string) => problem(404, 'Not Found', basePath)
const unauthorized = () => problem(401, 'JWT Token not found', '/api/errors/401')

function filterGenres(collection: Genre[], search: URLSearchParams): Genre[] {
  const name = search.get('name')
  const slugs = multiParam(search, 'slug')
  return collection.filter((genre) => {
    if (name && !genre.name.toLowerCase().includes(name.toLowerCase())) return false
    if (slugs.length > 0 && !slugs.includes(genre.slug)) return false
    return true
  })
}

/* ── Fake JWT ──────────────────────────────────────────────────────────────
 * Structurally valid (three base64url segments) but unsigned, so the real
 * `decodeJwt` / `isTokenExpired` code paths run exactly as in production.
 */

const base64url = (value: string) =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function issueToken(email: string, userId: number, ttlSeconds = 3600): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({
      iat: now,
      exp: now + ttlSeconds,
      username: email,
      sub: email,
      id: userId,
      roles: ['ROLE_USER'],
    }),
  )
  return `${header}.${payload}.mock-signature`
}

/** Resolves the caller from the `Authorization` header, or `null` if anonymous. */
function authenticate(request: Request) {
  const header = request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) return null
  try {
    const payload = header.slice(7).split('.')[1]
    if (!payload) return null
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number
      sub?: string
    }
    if (claims.exp && claims.exp * 1000 <= Date.now()) return null
    return claims.sub ? (findUserByEmail(claims.sub) ?? null) : null
  } catch {
    return null
  }
}

/** Minimal `{ '@id', '@type', id, username }` projection used by the read groups. */
function userRef(user: NonNullable<ReturnType<typeof findUserByIri>>) {
  return { '@id': user['@id'], '@type': 'User', id: user.id, username: user.username }
}

/** Matches a stored relation (embedded object) against an IRI query param. */
function matchesIri(relation: { '@id': string } | null | undefined, iri: string | null): boolean {
  if (!iri) return true
  return relation?.['@id'] === iri
}

export const handlers = [
  /* ── Auth ─────────────────────────────────────────────────────────────── */

  http.post('*/api/login', async ({ request }) => {
    await delay(250)
    const body = (await request.json()) as { email?: string; password?: string }
    const user = findUserByEmail(body.email ?? '')

    if (!user || passwords.get(user.email) !== body.password) {
      // The real backend answers 401 with a Lexik-shaped body.
      return HttpResponse.json({ code: 401, message: 'Invalid credentials.' }, { status: 401 })
    }

    seedNotifications(user['@id'])
    // `application/json` only — that is what the contract declares for login.
    return HttpResponse.json({ token: issueToken(user.email, user.id ?? 0) })
  }),

  http.post('*/api/register', async ({ request }) => {
    await delay(250)
    const body = (await request.json()) as {
      email?: string
      username?: string
      plainPassword?: string
    }

    if (!body.email || !body.username || !body.plainPassword) {
      return problem(422, 'email, username et plainPassword sont requis.')
    }
    if (findUserByEmail(body.email)) {
      return problem(422, 'Cette adresse e-mail est déjà utilisée.')
    }

    const user = createUser(body.email, body.username, body.plainPassword)
    return HttpResponse.json(
      { '@context': '/api/contexts/User', ...user },
      { status: 201, headers: LD_JSON },
    )
  }),

  http.get('*/api/me', async ({ request }) => {
    await delay(120)
    const user = authenticate(request)
    if (!user) return unauthorized()

    // ⚠️ Faithfully reproduces a real-backend quirk: `/api/me` is a custom
    // operation, so API Platform serialises `"@id": "/api/me"` — the operation
    // IRI, **not** `/api/users/{id}`. The front rebuilds the resource IRI from
    // `id` (see `canonicalUserIri` in `src/api/auth.ts`); returning the "nice"
    // IRI here would make the mocks kinder than reality and hide the bug.
    return HttpResponse.json(
      { '@context': '/api/contexts/User', ...user, '@id': '/api/me' },
      { headers: LD_JSON },
    )
  }),

  /* ── Catalogue ────────────────────────────────────────────────────────── */

  http.get('*/api/animes', async ({ request }) => {
    // Small artificial latency so loading skeletons are actually observable.
    await delay(300)
    const search = new URL(request.url).searchParams
    return hydraCollection(request, '/api/animes', 'Anime', applyFilters(animes, search))
  }),

  http.get('*/api/animes/:id', async ({ params }) => {
    await delay(200)
    const anime = animes.find((item) => String(item.id) === String(params.id))
    if (!anime) return notFound(`/api/animes/${params.id}`)
    // The item read group additionally embeds `episodes[]`.
    return HttpResponse.json(
      {
        '@context': '/api/contexts/Anime',
        ...anime,
        episodes: episodesFor(anime.id ?? 0, anime.episodeCount),
      },
      { headers: LD_JSON },
    )
  }),

  http.get('*/api/mangas', async ({ request }) => {
    await delay(300)
    const search = new URL(request.url).searchParams
    return hydraCollection(request, '/api/mangas', 'Manga', applyFilters(mangas, search))
  }),

  http.get('*/api/mangas/:id', async ({ params }) => {
    await delay(200)
    const manga = mangas.find((item) => String(item.id) === String(params.id))
    if (!manga) return notFound(`/api/mangas/${params.id}`)
    // The item read group additionally embeds `chapters[]`.
    return HttpResponse.json(
      {
        '@context': '/api/contexts/Manga',
        ...manga,
        chapters: chaptersFor(manga.id ?? 0, manga.chapterCount),
      },
      { headers: LD_JSON },
    )
  }),

  http.get('*/api/genres', async ({ request }) => {
    await delay(150)
    const search = new URL(request.url).searchParams
    return hydraCollection(request, '/api/genres', 'Genre', filterGenres(genres, search))
  }),

  http.get('*/api/genres/:id', async ({ params }) => {
    await delay(150)
    const genre = genres.find((item) => String(item.id) === String(params.id))
    if (!genre) return notFound(`/api/genres/${params.id}`)
    // Item read group exposes the related resources as IRI arrays.
    return HttpResponse.json(
      {
        '@context': '/api/contexts/Genre',
        ...genre,
        animes: animes
          .filter((a) => a.genres?.some((g) => g.slug === genre.slug))
          .map((a) => a['@id']),
        mangas: mangas
          .filter((m) => m.genres?.some((g) => g.slug === genre.slug))
          .map((m) => m['@id']),
      },
      { headers: LD_JSON },
    )
  }),

  /* ── Favourites ───────────────────────────────────────────────────────── */

  http.get('*/api/favorites', async ({ request }) => {
    await delay(180)
    const user = authenticate(request)
    if (!user) return unauthorized()

    const search = new URL(request.url).searchParams
    // The real backend scopes the collection to the current user; do the same
    // here, so the front cannot accidentally rely on seeing everyone's rows.
    const mine = favorites.filter((favorite) => favorite.user['@id'] === user['@id'])
    const filtered = mine.filter(
      (favorite) =>
        matchesIri(favorite.anime, search.get('anime')) &&
        matchesIri(favorite.manga, search.get('manga')),
    )

    return hydraCollection(request, '/api/favorites', 'Favorite', filtered)
  }),

  http.post('*/api/favorites', async ({ request }) => {
    await delay(200)
    const user = authenticate(request)
    if (!user) return unauthorized()

    const body = (await request.json()) as { anime?: string | null; manga?: string | null }
    const targetIri = body.anime ?? body.manga
    if (!targetIri) return problem(422, 'anime ou manga est requis.')

    const target = mediaRefFor(targetIri)
    if (!target) return problem(422, `Ressource inconnue : ${targetIri}`)

    // The real entity carries a unique constraint on (user, anime|manga).
    //
    // Divergence, on purpose: the real backend currently lets the constraint
    // violation escape as a **500** with a raw `SQLSTATE[23505]` message and a
    // stack trace (observed 2026-08-01, reported upstream). We answer the 422
    // it *should* be. `unwrap`'s `humanizeDetail` copes with both, so the UI is
    // exercised against the correct behaviour without going blind to the bug.
    const duplicate = favorites.find(
      (favorite) =>
        favorite.user['@id'] === user['@id'] &&
        (favorite.anime?.['@id'] === targetIri || favorite.manga?.['@id'] === targetIri),
    )
    if (duplicate) return problem(422, 'Ce titre est déjà dans vos favoris.')

    const id = takeId()
    const favorite = {
      '@id': `/api/favorites/${id}`,
      '@type': 'Favorite',
      id,
      user: userRef(user),
      anime: target.kind === 'anime' ? target.ref : null,
      manga: target.kind === 'manga' ? target.ref : null,
      createdAt: new Date().toISOString(),
    } as unknown as MockFavorite

    favorites.push(favorite)
    return HttpResponse.json(
      { '@context': '/api/contexts/Favorite', ...favorite },
      { status: 201, headers: LD_JSON },
    )
  }),

  http.delete('*/api/favorites/:id', async ({ request, params }) => {
    await delay(160)
    const user = authenticate(request)
    if (!user) return unauthorized()

    const index = favorites.findIndex((favorite) => String(favorite.id) === String(params.id))
    if (index === -1) return notFound(`/api/favorites/${params.id}`)
    if (favorites[index].user['@id'] !== user['@id']) return problem(403, 'Accès refusé.')

    favorites.splice(index, 1)
    return new HttpResponse(null, { status: 204 })
  }),

  /* ── Progress ─────────────────────────────────────────────────────────── */

  http.get('*/api/progress', async ({ request }) => {
    await delay(180)
    const user = authenticate(request)
    if (!user) return unauthorized()

    const mine = progress.filter((entry) => entry.user['@id'] === user['@id'])
    return hydraCollection(request, '/api/progress', 'Progress', mine)
  }),

  http.post('*/api/progress', async ({ request }) => {
    await delay(200)
    const user = authenticate(request)
    if (!user) return unauthorized()

    const body = (await request.json()) as Record<string, unknown>
    const targetIri = (body.anime as string | null) ?? (body.manga as string | null)
    if (!targetIri) return problem(422, 'anime ou manga est requis.')

    const target = mediaRefFor(targetIri)
    if (!target) return problem(422, `Ressource inconnue : ${targetIri}`)

    const id = takeId()
    const entry = {
      '@id': `/api/progress/${id}`,
      '@type': 'Progress',
      id,
      user: userRef(user),
      anime: target.kind === 'anime' ? target.ref : null,
      manga: target.kind === 'manga' ? target.ref : null,
      currentEpisode: (body.currentEpisode as number | null) ?? null,
      // Kept as a **string**: the contract serialises `decimal(8,2)` that way.
      currentChapter: (body.currentChapter as string | null) ?? null,
      status: (body.status as MockProgress['status']) ?? 'PLANNED',
      score: (body.score as number | null) ?? null,
      updatedAt: new Date().toISOString(),
    } as unknown as MockProgress

    progress.push(entry)
    return HttpResponse.json(
      { '@context': '/api/contexts/Progress', ...entry },
      { status: 201, headers: LD_JSON },
    )
  }),

  http.patch('*/api/progress/:id', async ({ request, params }) => {
    await delay(200)
    const user = authenticate(request)
    if (!user) return unauthorized()

    // API Platform only accepts merge-patch on this operation; sending plain
    // JSON must fail here exactly as it would against the real backend.
    if (!(request.headers.get('Content-Type') ?? '').includes('merge-patch+json')) {
      return problem(415, 'Unsupported Media Type: expected application/merge-patch+json.')
    }

    const entry = progress.find((item) => String(item.id) === String(params.id))
    if (!entry) return notFound(`/api/progress/${params.id}`)
    if (entry.user['@id'] !== user['@id']) return problem(403, 'Accès refusé.')

    const body = (await request.json()) as Record<string, unknown>
    if ('status' in body) entry.status = body.status as MockProgress['status']
    if ('currentEpisode' in body) entry.currentEpisode = body.currentEpisode as number | null
    if ('currentChapter' in body) entry.currentChapter = body.currentChapter as string | null
    if ('score' in body) entry.score = body.score as number | null
    entry.updatedAt = new Date().toISOString()

    return HttpResponse.json(
      { '@context': '/api/contexts/Progress', ...entry },
      { headers: LD_JSON },
    )
  }),

  /* ── Comments ─────────────────────────────────────────────────────────── */

  http.get('*/api/comments', async ({ request }) => {
    await delay(200)
    const search = new URL(request.url).searchParams

    // Comments are public: no authentication required to read them.
    const filtered = comments.filter(
      (comment) =>
        matchesIri(comment.anime, search.get('anime')) &&
        matchesIri(comment.manga, search.get('manga')),
    )

    const direction = search.get('order[createdAt]') === 'asc' ? 1 : -1
    filtered.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') * direction)

    return hydraCollection(request, '/api/comments', 'Comment', filtered)
  }),

  http.post('*/api/comments', async ({ request }) => {
    await delay(220)
    const user = authenticate(request)
    if (!user) return unauthorized()

    const body = (await request.json()) as Record<string, unknown>
    const content = String(body.content ?? '').trim()
    if (!content) return problem(422, 'Le commentaire ne peut pas être vide.')

    const targetIri = (body.anime as string | null) ?? (body.manga as string | null)
    const target = targetIri ? mediaRefFor(targetIri) : null
    if (!target) return problem(422, 'anime ou manga est requis.')

    // `parent` arrives as an IRI even though the contract types it as a nested
    // write object — see the note in `src/api/comments.ts`.
    const parentIri = typeof body.parent === 'string' ? body.parent : null
    const parent = parentIri
      ? (comments.find((comment) => comment['@id'] === parentIri) ?? null)
      : null
    if (parentIri && !parent) return problem(422, 'Commentaire parent introuvable.')

    const id = takeId()
    const mediaRef = { '@id': target.ref['@id'], '@type': target.kind === 'anime' ? 'Anime' : 'Manga', id: target.ref.id }
    const comment = {
      '@id': `/api/comments/${id}`,
      '@type': 'Comment',
      id,
      user: userRef(user),
      content,
      anime: target.kind === 'anime' ? mediaRef : null,
      manga: target.kind === 'manga' ? mediaRef : null,
      parent: parent ? { '@id': parent['@id'], '@type': 'Comment', id: parent.id } : null,
      createdAt: new Date().toISOString(),
    } as unknown as MockComment

    comments.push(comment)
    return HttpResponse.json(
      { '@context': '/api/contexts/Comment', ...comment },
      { status: 201, headers: LD_JSON },
    )
  }),

  http.delete('*/api/comments/:id', async ({ request, params }) => {
    await delay(160)
    const user = authenticate(request)
    if (!user) return unauthorized()

    const index = comments.findIndex((comment) => String(comment.id) === String(params.id))
    if (index === -1) return notFound(`/api/comments/${params.id}`)
    if (comments[index].user['@id'] !== user['@id']) return problem(403, 'Accès refusé.')

    const removed = comments[index]
    comments.splice(index, 1)
    // Cascade: the real schema deletes replies along with their parent.
    for (let i = comments.length - 1; i >= 0; i--) {
      if (comments[i].parent?.['@id'] === removed['@id']) comments.splice(i, 1)
    }

    return new HttpResponse(null, { status: 204 })
  }),

  /* ── Notifications ────────────────────────────────────────────────────── */

  http.get('*/api/notifications', async ({ request }) => {
    await delay(180)
    const user = authenticate(request)
    if (!user) return unauthorized()

    const search = new URL(request.url).searchParams
    let mine = notifications.filter((item) => item.user['@id'] === user['@id'])

    const isRead = search.get('isRead')
    if (isRead !== null) mine = mine.filter((item) => item.isRead === (isRead === 'true'))

    const direction = search.get('order[createdAt]') === 'asc' ? 1 : -1
    mine = [...mine].sort(
      (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') * direction,
    )

    return hydraCollection(request, '/api/notifications', 'Notification', mine)
  }),

  http.patch('*/api/notifications/:id', async ({ request, params }) => {
    await delay(150)
    const user = authenticate(request)
    if (!user) return unauthorized()

    if (!(request.headers.get('Content-Type') ?? '').includes('merge-patch+json')) {
      return problem(415, 'Unsupported Media Type: expected application/merge-patch+json.')
    }

    const entry = notifications.find((item) => String(item.id) === String(params.id))
    if (!entry) return notFound(`/api/notifications/${params.id}`)
    if (entry.user['@id'] !== user['@id']) return problem(403, 'Accès refusé.')

    const body = (await request.json()) as Partial<MockNotification>
    if (typeof body.isRead === 'boolean') entry.isRead = body.isRead

    return HttpResponse.json(
      { '@context': '/api/contexts/Notification', ...entry },
      { headers: LD_JSON },
    )
  }),

  /* ── Users (legacy collection; the contract still exposes it) ──────────── */

  http.get('*/api/users', async ({ request }) => {
    await delay(150)
    const search = new URL(request.url).searchParams
    const email = search.get('email')
    const filtered = email
      ? users.filter((user) => user.email.toLowerCase() === email.toLowerCase())
      : users
    return hydraCollection(request, '/api/users', 'User', filtered)
  }),
]
