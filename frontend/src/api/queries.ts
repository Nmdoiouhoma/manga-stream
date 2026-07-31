/**
 * React Query hooks over the typed API client.
 *
 * Query parameters below are NOT invented: every one of them is declared in
 * `docs/openapi.yaml` for the corresponding operation.
 *   - `titleRomaji`      → partial, case-insensitive SearchFilter
 *   - `genres.slug[]`    → exact match on the related genre slug, repeatable
 *   - `status[]`         → exact match on the status enum, repeatable
 *   - `season`           → anime only (mangas have no season filter)
 *   - `page`/`itemsPerPage` → pagination (default 30, max 100)
 *
 * The catalogue can browse animes and mangas at the same time ("Tout"), but the
 * backend exposes them as two separate API Platform collections. Rather than
 * faking a single paginated stream, the catalogue keeps one cursor per
 * collection and advances the ones that still advertise a Hydra `next` link.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { apiClient, unwrap } from './client'
import { normalizeCollection } from './hydra'
import { ITEMS_PER_PAGE } from '../config'
import {
  animeToMediaItem,
  mangaToMediaItem,
  type Genre,
  type MediaItem,
  type MediaKindFilter,
  type MediaSeason,
  type MediaStatus,
} from '../types/media'

export type CatalogFilters = {
  /** Free-text search. Applied to `titleRomaji` — see the note in `filterParams`. */
  search: string
  /** Selected genre slugs. API Platform ORs repeated values of the same filter. */
  genres: string[]
  status: MediaStatus | 'all'
  season: MediaSeason | 'all'
  kind: MediaKindFilter
}

export const DEFAULT_FILTERS: CatalogFilters = {
  search: '',
  genres: [],
  status: 'all',
  season: 'all',
  kind: 'all',
}

/** One cursor per collection; `null` means "exhausted, or excluded by the type filter". */
type CatalogCursor = { anime: number | null; manga: number | null }

type CatalogPage = {
  items: MediaItem[]
  /** Total across the collections currently being browsed. */
  totalItems: number
  next: CatalogCursor | null
}

/**
 * Query params shared by the anime and manga collections.
 *
 * ⚠️ Contract limitation: there is no combined `title` filter. The API exposes
 * `titleRomaji`, `titleEnglish` and `titleNative` as three independent
 * SearchFilters, and API Platform ANDs different filters together — so we
 * cannot express "romaji OR english" in one request. We search `titleRomaji`,
 * the only title the contract marks as required. Asking the backend for a
 * combined title search is tracked as a phase-2 item.
 */
function filterParams(filters: CatalogFilters) {
  return {
    itemsPerPage: ITEMS_PER_PAGE,
    ...(filters.search ? { titleRomaji: filters.search } : {}),
    ...(filters.genres.length > 0 ? { 'genres.slug[]': filters.genres } : {}),
    ...(filters.status !== 'all' ? { 'status[]': [filters.status] } : {}),
  }
}

async function fetchAnimePage(filters: CatalogFilters, page: number) {
  const result = await apiClient.GET('/api/animes', {
    params: {
      query: {
        ...filterParams(filters),
        page,
        // `season` exists on the anime collection only.
        ...(filters.season !== 'all' ? { season: filters.season } : {}),
      },
    },
  })
  return normalizeCollection(unwrap(result))
}

async function fetchMangaPage(filters: CatalogFilters, page: number) {
  const result = await apiClient.GET('/api/mangas', {
    params: { query: { ...filterParams(filters), page } },
  })
  return normalizeCollection(unwrap(result))
}

async function fetchCatalogPage(
  filters: CatalogFilters,
  cursor: CatalogCursor,
): Promise<CatalogPage> {
  const [animeResult, mangaResult] = await Promise.all([
    cursor.anime !== null ? fetchAnimePage(filters, cursor.anime) : null,
    cursor.manga !== null ? fetchMangaPage(filters, cursor.manga) : null,
  ])

  const items: MediaItem[] = [
    ...(animeResult?.member ?? []).map(animeToMediaItem),
    ...(mangaResult?.member ?? []).map(mangaToMediaItem),
  ]

  // A mixed page reads better sorted by score than grouped by collection.
  items.sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0))

  const next: CatalogCursor = {
    anime: animeResult?.hasNextPage && cursor.anime !== null ? cursor.anime + 1 : null,
    manga: mangaResult?.hasNextPage && cursor.manga !== null ? cursor.manga + 1 : null,
  }

  return {
    items,
    totalItems: (animeResult?.totalItems ?? 0) + (mangaResult?.totalItems ?? 0),
    next: next.anime === null && next.manga === null ? null : next,
  }
}

/**
 * Infinite catalogue query. Returns a flat list of normalised media items plus
 * the total number of results matching the current filters.
 */
export function useCatalog(filters: CatalogFilters) {
  const initialCursor: CatalogCursor = {
    anime: filters.kind === 'manga' ? null : 1,
    manga: filters.kind === 'anime' ? null : 1,
  }

  const query = useInfiniteQuery({
    queryKey: ['catalog', filters],
    queryFn: ({ pageParam }) => fetchCatalogPage(filters, pageParam),
    initialPageParam: initialCursor,
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
  })

  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const totalItems = query.data?.pages[0]?.totalItems ?? 0

  return { ...query, items, totalItems }
}

/** All genres, for the multi-select filter. Effectively static, so cached hard. */
export function useGenres() {
  return useQuery<Genre[]>({
    queryKey: ['genres'],
    queryFn: async () => {
      const result = await apiClient.GET('/api/genres', {
        // 100 is the contract's documented maximum page size.
        params: { query: { itemsPerPage: 100, 'order[name]': 'asc' } },
      })
      return normalizeCollection(unwrap(result)).member
    },
    staleTime: Infinity,
  })
}
