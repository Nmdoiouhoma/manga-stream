import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFavorites, useToggleFavorite, type FavoriteEntry } from '../api/favorites'
import type { MediaKindFilter } from '../types/media'

const KIND_OPTIONS: { value: MediaKindFilter; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'anime', label: 'Animes' },
  { value: 'manga', label: 'Mangas' },
]

export function FavoritesPage() {
  const { entries, isLoading, isError, error, refetch } = useFavorites()
  const toggle = useToggleFavorite()
  const [kind, setKind] = useState<MediaKindFilter>('all')

  // Filtering client-side: a personal list fits in the single 100-item page we
  // already fetched, so a round-trip per tab click would be pure latency.
  const visible = kind === 'all' ? entries : entries.filter((entry) => entry.kind === kind)

  const counts = {
    all: entries.length,
    anime: entries.filter((entry) => entry.kind === 'anime').length,
    manga: entries.filter((entry) => entry.kind === 'manga').length,
  }

  return (
    <div className="catalog">
      <header className="catalog__header">
        <h1 className="catalog__title">Favoris</h1>
        <p className="catalog__subtitle">Les titres que vous suivez.</p>
      </header>

      <div className="filters__row">
        <div className="segmented" role="group" aria-label="Type de média">
          {KIND_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`segmented__item ${kind === option.value ? 'is-active' : ''}`}
              aria-pressed={kind === option.value}
              onClick={() => setKind(option.value)}
            >
              {option.label} <span className="segmented__count">{counts[option.value]}</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="muted">Chargement de vos favoris…</p>}

      {isError && (
        <div className="panel panel--error" role="alert">
          <h2>Impossible de charger vos favoris</h2>
          <p>{error instanceof Error ? error.message : 'Erreur inconnue'}</p>
          <button type="button" className="btn" onClick={() => void refetch()}>
            Réessayer
          </button>
        </div>
      )}

      {!isLoading && !isError && entries.length === 0 && (
        <div className="panel">
          <h2>Aucun favori</h2>
          <p>Parcourez le catalogue et ajoutez des titres avec le cœur sur les fiches.</p>
          <Link to="/" className="btn">
            Aller au catalogue
          </Link>
        </div>
      )}

      {!isLoading && !isError && entries.length > 0 && visible.length === 0 && (
        <p className="muted">Aucun favori de ce type.</p>
      )}

      {toggle.isError && (
        <p className="form__error" role="alert">
          {toggle.error instanceof Error ? toggle.error.message : 'Le retrait a échoué'}
        </p>
      )}

      <ul className="fav-list">
        {visible.map((entry) => (
          <li key={entry.targetIri}>
            <FavoriteRow
              entry={entry}
              onRemove={() =>
                toggle.mutate({
                  targetIri: entry.targetIri,
                  kind: entry.kind,
                  title: entry.title,
                  coverImage: entry.coverImage,
                  existing: entry,
                })
              }
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function FavoriteRow({ entry, onRemove }: { entry: FavoriteEntry; onRemove: () => void }) {
  return (
    <article className={`fav-row ${entry.pending ? 'is-pending' : ''}`}>
      <Link to={entry.href} className="fav-row__link">
        <span className="fav-row__cover">
          {entry.coverImage ? (
            <img src={entry.coverImage} alt="" loading="lazy" />
          ) : (
            <span className="card__cover-fallback" aria-hidden="true">
              {entry.title.slice(0, 2).toUpperCase()}
            </span>
          )}
        </span>

        <span className="fav-row__body">
          <span className="fav-row__title">{entry.title}</span>
          <span className={`card__kind card__kind--${entry.kind}`}>
            {entry.kind === 'anime' ? 'Anime' : 'Manga'}
          </span>
        </span>
      </Link>

      <button
        type="button"
        className="btn btn--ghost btn--danger"
        onClick={onRemove}
        // No server id yet: the DELETE would target /api/favorites/null.
        disabled={entry.pending}
      >
        Retirer
      </button>
    </article>
  )
}
