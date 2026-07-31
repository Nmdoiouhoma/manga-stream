import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilterBar } from '../components/FilterBar'
import { MediaCard, MediaCardSkeleton } from '../components/MediaCard'
import { DEFAULT_FILTERS, useCatalog, useGenres, type CatalogFilters } from '../api/queries'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { ITEMS_PER_PAGE } from '../config'

export function CatalogPage() {
  // The raw input is kept separate from the debounced value that drives the query.
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput, 350)
  const [filters, setFilters] = useState<CatalogFilters>(DEFAULT_FILTERS)

  const effectiveFilters = useMemo<CatalogFilters>(
    () => ({ ...filters, search: debouncedSearch.trim() }),
    [filters, debouncedSearch],
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

  const handleChange = useCallback((next: Partial<CatalogFilters>) => {
    setFilters((current) => ({ ...current, ...next }))
  }, [])

  const handleReset = useCallback(() => {
    setSearchInput('')
    setFilters(DEFAULT_FILTERS)
  }, [])

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
          Animes et mangas, filtrés par genre, statut, saison et titre.
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
          ? Array.from({ length: ITEMS_PER_PAGE }, (_, index) => (
              <MediaCardSkeleton key={index} />
            ))
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
        {!hasNextPage && items.length > 0 && (
          <p className="catalog__end">Fin du catalogue</p>
        )}
      </div>
    </div>
  )
}
