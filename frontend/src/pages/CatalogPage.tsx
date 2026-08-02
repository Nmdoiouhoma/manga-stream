import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FilterBar } from '../components/FilterBar'
import { MediaCard, MediaCardSkeleton } from '../components/MediaCard'
import { DEFAULT_FILTERS, useCatalog, useGenres, type CatalogFilters } from '../api/queries'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { ITEMS_PER_PAGE } from '../config'
import { MEDIA_STATUSES, SEASON_LABELS, type MediaKindFilter, type MediaSeason, type MediaStatus } from '../types/media'

/**
 * Filters live in the **query string**, not only in component state.
 *
 * That is what makes the genre chips on a detail page work: they are plain
 * `<Link to="/?genre=action">`, no shared store, no navigation state to thread
 * through. It also makes a filtered catalogue shareable, survivable across a
 * reload, and gives back/forward the behaviour users expect.
 */
function readFilters(params: URLSearchParams): CatalogFilters {
  return {
    search: params.get('q') ?? '',
    genres: params.getAll('genre').filter(Boolean),
    // Query-string values are user-controlled: validate against the contract
    // enums rather than casting, or a crafted URL sends garbage to the API.
    status: isStatus(params.get('status')) ? (params.get('status') as MediaStatus) : 'all',
    season: isSeason(params.get('season')) ? (params.get('season') as MediaSeason) : 'all',
    kind: isKind(params.get('kind')) ? (params.get('kind') as MediaKindFilter) : 'all',
  }
}

const SEASON_VALUES = Object.keys(SEASON_LABELS)

function isStatus(value: string | null): boolean {
  return value !== null && (MEDIA_STATUSES as readonly string[]).includes(value)
}
function isSeason(value: string | null): boolean {
  return value !== null && SEASON_VALUES.includes(value)
}
function isKind(value: string | null): boolean {
  return value === 'anime' || value === 'manga' || value === 'all'
}

/** Serialises filters back to the query string, omitting every default. */
function writeFilters(filters: CatalogFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.search) params.set('q', filters.search)
  for (const genre of filters.genres) params.append('genre', genre)
  if (filters.status !== 'all') params.set('status', filters.status)
  if (filters.season !== 'all') params.set('season', filters.season)
  if (filters.kind !== 'all') params.set('kind', filters.kind)
  return params
}

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlFilters = useMemo(() => readFilters(searchParams), [searchParams])
  const urlSearch = urlFilters.search

  // The raw input is kept separate from the debounced value that drives the
  // query — and from the URL, which only ever receives the settled value.
  const [searchInput, setSearchInput] = useState(urlSearch)
  const debouncedSearch = useDebouncedValue(searchInput, 350)

  // Adopt an externally-changed URL term (genre link, browser back). The
  // functional update makes this a no-op when the values already agree, so it
  // cannot fight the user's typing.
  useEffect(() => {
    setSearchInput((current) => (current === urlSearch ? current : urlSearch))
  }, [urlSearch])

  // Push the debounced term into the URL once it has settled. `replace` keeps
  // every keystroke out of the history stack.
  useEffect(() => {
    const trimmed = debouncedSearch.trim()
    if (trimmed === urlSearch) return
    setSearchParams(writeFilters({ ...urlFilters, search: trimmed }), { replace: true })
  }, [debouncedSearch, urlSearch, urlFilters, setSearchParams])

  const effectiveFilters = useMemo<CatalogFilters>(
    () => ({ ...urlFilters, search: debouncedSearch.trim() }),
    [urlFilters, debouncedSearch],
  )

  const { data: genres, isLoading: genresLoading } = useGenres()
  const {
    items,
    totalItems,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
  } = useCatalog(effectiveFilters)

  const handleChange = useCallback(
    (next: Partial<CatalogFilters>) => {
      setSearchParams(writeFilters({ ...urlFilters, ...next }))
    },
    [urlFilters, setSearchParams],
  )

  const handleReset = useCallback(() => {
    setSearchInput('')
    setSearchParams(writeFilters(DEFAULT_FILTERS))
  }, [setSearchParams])

  // Infinite scroll: load the next page when the sentinel enters the viewport.
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage()
        }
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const showSkeletons = isLoading
  const isEmpty = !isLoading && !isError && items.length === 0

  return (
    <div className="catalog">
      <header className="catalog__header">
        <h1 className="catalog__title">Catalogue</h1>
        <p className="catalog__subtitle">
          Animes et mangas à suivre : filtrez par genre, statut, saison ou titre, puis ajoutez-les
          à votre liste.
        </p>
      </header>

      <FilterBar
        filters={effectiveFilters}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        onChange={handleChange}
        onReset={handleReset}
        genres={genres ?? []}
        genresLoading={genresLoading}
      />

      <div className="catalog__status" role="status" aria-live="polite">
        {isLoading
          ? 'Chargement du catalogue…'
          : isError
            ? ''
            : `${totalItems} résultat${totalItems > 1 ? 's' : ''}`}
        {!isLoading && isFetching && !isFetchingNextPage && (
          <span className="catalog__refreshing"> · mise à jour…</span>
        )}
      </div>

      {isError && (
        <div className="panel panel--error" role="alert">
          <h2>Impossible de charger le catalogue</h2>
          <p>{error instanceof Error ? error.message : 'Erreur inconnue'}</p>
          <button type="button" className="btn" onClick={() => void refetch()}>
            Réessayer
          </button>
        </div>
      )}

      {isEmpty && (
        <div className="panel">
          <h2>Aucun résultat</h2>
          <p>Aucun titre ne correspond à ces filtres. Essayez d’élargir la recherche.</p>
          <button type="button" className="btn" onClick={handleReset}>
            Réinitialiser les filtres
          </button>
        </div>
      )}

      <div className="grid">
        {showSkeletons
          ? Array.from({ length: ITEMS_PER_PAGE }, (_, index) => <MediaCardSkeleton key={index} />)
          : items.map((item) => <MediaCard key={item.key} item={item} />)}

        {isFetchingNextPage &&
          Array.from({ length: 4 }, (_, index) => <MediaCardSkeleton key={`next-${index}`} />)}
      </div>

      {/* Sentinel for the IntersectionObserver, plus an explicit fallback button. */}
      <div ref={sentinelRef} className="catalog__sentinel">
        {hasNextPage && !isFetchingNextPage && (
          <button type="button" className="btn" onClick={() => void fetchNextPage()}>
            Charger plus
          </button>
        )}
        {!hasNextPage && items.length > 0 && <p className="catalog__end">Fin du catalogue</p>}
      </div>
    </div>
  )
}
