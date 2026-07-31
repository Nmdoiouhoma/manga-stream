import type { CatalogFilters } from '../api/queries'
import {
  MEDIA_STATUSES,
  SEASON_LABELS,
  STATUS_LABELS,
  type Genre,
  type MediaKindFilter,
  type MediaSeason,
} from '../types/media'

type FilterBarProps = {
  filters: CatalogFilters
  /** Immediate search input value (not debounced) so typing stays responsive. */
  searchInput: string
  onSearchChange: (value: string) => void
  onChange: (next: Partial<CatalogFilters>) => void
  onReset: () => void
  genres: Genre[]
  genresLoading: boolean
}

const KIND_OPTIONS: { value: MediaKindFilter; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'anime', label: 'Animes' },
  { value: 'manga', label: 'Mangas' },
]

const SEASONS = Object.keys(SEASON_LABELS) as MediaSeason[]

export function FilterBar({
  filters,
  searchInput,
  onSearchChange,
  onChange,
  onReset,
  genres,
  genresLoading,
}: FilterBarProps) {
  const toggleGenre = (slug: string) => {
    const next = filters.genres.includes(slug)
      ? filters.genres.filter((value) => value !== slug)
      : [...filters.genres, slug]
    onChange({ genres: next })
  }

  const hasActiveFilters =
    filters.search !== '' ||
    filters.genres.length > 0 ||
    filters.status !== 'all' ||
    filters.season !== 'all' ||
    filters.kind !== 'all'

  // `season` is an anime-only filter in the contract; hide it when browsing mangas.
  const seasonAvailable = filters.kind !== 'manga'

  return (
    <section className="filters" aria-label="Filtres du catalogue">
      <div className="filters__row">
        <div className="search">
          <svg className="search__icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            className="search__input"
            placeholder="Rechercher un titre (romaji)…"
            value={searchInput}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label="Rechercher un titre"
          />
        </div>

        {/* Type: anime / manga / both */}
        <div className="segmented" role="group" aria-label="Type de média">
          {KIND_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`segmented__item ${filters.kind === option.value ? 'is-active' : ''}`}
              aria-pressed={filters.kind === option.value}
              onClick={() => onChange({ kind: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>

        <select
          className="select"
          value={filters.status}
          aria-label="Statut"
          onChange={(event) => onChange({ status: event.target.value as CatalogFilters['status'] })}
        >
          <option value="all">Tous statuts</option>
          {MEDIA_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        {seasonAvailable && (
          <select
            className="select"
            value={filters.season}
            aria-label="Saison (animes)"
            onChange={(event) =>
              onChange({ season: event.target.value as CatalogFilters['season'] })
            }
          >
            <option value="all">Toutes saisons</option>
            {SEASONS.map((season) => (
              <option key={season} value={season}>
                {SEASON_LABELS[season]}
              </option>
            ))}
          </select>
        )}

        {hasActiveFilters && (
          <button type="button" className="btn btn--ghost" onClick={onReset}>
            Réinitialiser
          </button>
        )}
      </div>

      <div className="filters__genres">
        {genresLoading
          ? Array.from({ length: 8 }, (_, index) => (
              <span key={index} className="skeleton skeleton--chip" aria-hidden="true" />
            ))
          : genres.map((genre) => {
              const selected = filters.genres.includes(genre.slug)
              return (
                <button
                  key={genre['@id']}
                  type="button"
                  className={`chip ${selected ? 'is-selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => toggleGenre(genre.slug)}
                >
                  {genre.name}
                </button>
              )
            })}
      </div>
    </section>
  )
}
