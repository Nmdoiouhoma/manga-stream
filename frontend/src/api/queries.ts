/**
 * React Query hooks over the typed API client — catalogue and detail pages.
 *
 * Query parameters below are NOT invented: every one of them is declared in
 * `docs/openapi.yaml` for the corresponding operation.
 *   - `title`               → combined OR search on the three title columns
 *                             (custom backend filter, in the contract since
 *                             the 2026-08-01 regeneration)
 *   - `genres.slug[]`       → exact match on the related genre slug, repeatable
 *   - `status[]`            → exact match on the status enum, repeatable
 *   - `season`              → anime only (mangas have no season filter)
 *   - `page`/`itemsPerPage` → pagination (default 30, max 100)
 *
 * The catalogue can browse animes and mangas at the same time ("Tout"), but the
 * backend exposes them as two separate API Platform collections. Rather than
 * faking a single paginated stream, the catalogue keeps one cursor per
 * collection and advances the ones that still advertise a Hydra `next` link.
 */
import { useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { apiClient, unwrap } from './client'
import { normalizeCollection } from './hydra'
import { ITEMS_PER_PAGE } from '../config'
import type { paths } from './schema'
import {
  animeToMediaDetail,
  animeToMediaItem,
  mangaToMediaDetail,
  mangaToMediaItem,
  type Genre,
  type MediaDetail,
  type MediaItem,
  type MediaKind,
  type MediaKindFilter,
  type MediaSeason,
  type MediaStatus,
} from '../types/media'

export type CatalogFilters = {
  /** Free-text search, applied to the combined `title` filter. */
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

type AnimeQuery = NonNullable<paths['/api/animes']['get']['parameters']['query']>
type MangaQuery = NonNullable<paths['/api/mangas']['get']['parameters']['query']>

/** One cursor per collection; `null` means "exhausted, or excluded by the type filter". */
type CatalogCursor = { anime: number | null; manga: number | null }

type CatalogPage = {
  items: MediaItem[]
  /** Total across the collections currently being browsed. */
  totalItems: number
  next: CatalogCursor | null
}

/** Query params shared by the anime and manga collections. */
function filterParams(filters: CatalogFilters) {
  return {
    itemsPerPage: ITEMS_PER_PAGE,
    ...(filters.search ? { title: filters.search } : {}),
    ...(filters.genres.length > 0 ? { 'genres.slug[]': filters.genres } : {}),
    ...(filters.status !== 'all' ? { 'status[]': [filters.status] } : {}),
  }
}

async function fetchAnimePage(filters: CatalogFilters, page: number) {
  const query: AnimeQuery = {
    ...filterParams(filters),
    page,
    // `season` exists on the anime collection only.
    ...(filters.season !== 'all' ? { season: filters.season } : {}),
  }
  const result = await apiClient.GET('/api/animes', { params: { query } })
  return normalizeCollection(unwrap(result))
}

async function fetchMangaPage(filters: CatalogFilters, page: number) {
  const query: MangaQuery = { ...filterParams(filters), page }
  const result = await apiClient.GET('/api/mangas', { params: { query } })
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

/**
 * Traduit un **slug** de genre en libellé affichable.
 *
 * Le besoin vient des recommandations : le `reason` renvoyé par le backend
 * liste des slugs (`"psychological"`), pas des noms (`"Psychological"`). La
 * liste des genres est déjà en cache (`staleTime: Infinity`) pour la barre de
 * filtres, donc cette résolution ne coûte aucune requête supplémentaire.
 *
 * Repli sur le slug capitalisé quand il est inconnu : un genre absent de la
 * table ne doit pas faire disparaître l'explication, qui est justement ce qui
 * rend la suggestion crédible.
 */
export function useGenreLabel(): (slug: string) => string {
  const { data: genres } = useGenres()

  return useMemo(() => {
    const bySlug = new Map((genres ?? []).map((genre) => [genre.slug, genre.name]))
    return (slug: string) => bySlug.get(slug) ?? slug.charAt(0).toUpperCase() + slug.slice(1)
  }, [genres])
}

/* ────────────────────────────── Detail pages ────────────────────────────── */

/**
 * One media item, from whichever collection it belongs to.
 *
 * The item endpoint serves the `*.item.read` group, which embeds `episodes[]`
 * (anime) or `chapters[]` (manga) — no second request needed for the listing.
 *
 * `retry: false` matters here: a 404 is a legitimate answer for a bad id, and
 * retrying it only delays the "not found" screen.
 */
export function useMediaDetail(kind: MediaKind, id: string | undefined) {
  return useQuery<MediaDetail>({
    queryKey: ['media', kind, id],
    enabled: Boolean(id),
    retry: false,
    queryFn: async () => {
      // The cast is safe: `enabled` keeps the query from running without an id.
      const identifier = id as string
      if (kind === 'anime') {
        const result = await apiClient.GET('/api/animes/{id}', {
          params: { path: { id: identifier } },
        })
        return animeToMediaDetail(unwrap(result))
      }
      const result = await apiClient.GET('/api/mangas/{id}', {
        params: { path: { id: identifier } },
      })
      return mangaToMediaDetail(unwrap(result))
    },
  })
}
