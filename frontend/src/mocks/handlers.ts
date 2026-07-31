/**
 * MSW request handlers standing in for the API Platform 4 backend.
 *
 * These are aligned on the real contract (`docs/openapi.yaml`): same routes,
 * same query-parameter names, same JSON-LD/Hydra envelope, same enums. The goal
 * is that switching `VITE_USE_MOCKS` to `false` changes nothing but the data.
 *
 * Implemented per the contract:
 *   - `?page` / `?itemsPerPage` (default 30, max 100)
 *   - partial case-insensitive search on `titleRomaji` / `titleEnglish` / `titleNative`
 *   - exact filters on `status`, `season`, `seasonYear`, `genres.slug`
 *     (each accepts the scalar form and the repeated `[]` form, OR-ed)
 *   - `order[...]=asc|desc`
 * Responses are served as `application/ld+json`, the format the app commits to.
 */
import { http, HttpResponse, delay } from 'msw'
import { animes, mangas, genres } from './data'
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

  const statuses = multiParam(search, 'status')
  const seasons = multiParam(search, 'season')
  const seasonYears = multiParam(search, 'seasonYear')
  // The contract exposes both `genres` (IRI) and `genres.slug` (exact slug).
  const genreSlugs = multiParam(search, 'genres.slug')

  let result = collection.filter((item) => {
    if (titleRomaji && !partial(item.titleRomaji, titleRomaji)) return false
    if (titleEnglish && !partial(item.titleEnglish, titleEnglish)) return false
    if (titleNative && !partial(item.titleNative, titleNative)) return false

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
function hydraCollection<T>(
  request: Request,
  basePath: string,
  contextName: string,
  all: T[],
) {
  const search = new URL(request.url).searchParams
  const page = Math.max(Number(search.get('page') ?? '1') || 1, 1)
  const itemsPerPage = Math.min(
    Math.max(Number(search.get('itemsPerPage') ?? DEFAULT_ITEMS_PER_PAGE) || DEFAULT_ITEMS_PER_PAGE, 1),
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
function notFound(basePath: string) {
  return HttpResponse.json(
    {
      '@id': basePath,
      '@type': 'hydra:Error',
      title: 'An error occurred',
      detail: 'Not Found',
      status: 404,
    },
    { status: 404, headers: LD_JSON },
  )
}

function filterGenres(collection: Genre[], search: URLSearchParams): Genre[] {
  const name = search.get('name')
  const slugs = multiParam(search, 'slug')
  return collection.filter((genre) => {
    if (name && !genre.name.toLowerCase().includes(name.toLowerCase())) return false
    if (slugs.length > 0 && !slugs.includes(genre.slug)) return false
    return true
  })
}

export const handlers = [
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
    // The item read group additionally embeds `episodes[]` (empty until phase 2).
    return HttpResponse.json(
      { '@context': '/api/contexts/Anime', ...anime, episodes: [] },
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
    // The item read group additionally embeds `chapters[]` (empty until phase 2).
    return HttpResponse.json(
      { '@context': '/api/contexts/Manga', ...manga, chapters: [] },
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
        animes: animes.filter((a) => a.genres?.some((g) => g.slug === genre.slug)).map((a) => a['@id']),
        mangas: mangas.filter((m) => m.genres?.some((g) => g.slug === genre.slug)).map((m) => m['@id']),
      },
      { headers: LD_JSON },
    )
  }),
]
