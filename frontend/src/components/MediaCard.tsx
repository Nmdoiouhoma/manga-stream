import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FavoriteButton } from './FavoriteButton'
import { formatScore, STATUS_LABELS, type MediaItem } from '../types/media'

/**
 * Score badge colour bucket. `averageScore` is on the contract's 0-100 scale
 * (AniList convention), so the thresholds are expressed there too.
 */
function scoreTone(averageScore: number): string {
  if (averageScore >= 85) return 'is-high'
  if (averageScore >= 70) return 'is-mid'
  return 'is-low'
}

export function MediaCard({ item }: { item: MediaItem }) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = Boolean(item.coverImage) && !imageFailed

  return (
    <Link to={item.href} className="card" aria-label={item.title}>
      <div className="card__cover">
        {showImage ? (
          <img
            src={item.coverImage ?? ''}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          // Offline or blocked placeholder host: fall back to a typographic cover.
          <div className="card__cover-fallback" aria-hidden="true">
            <span>{item.title.slice(0, 2).toUpperCase()}</span>
          </div>
        )}

        <span className={`card__kind card__kind--${item.kind}`}>
          {item.kind === 'anime' ? 'Anime' : 'Manga'}
        </span>

        {item.averageScore !== null && (
          <span className={`card__score ${scoreTone(item.averageScore)}`}>
            {formatScore(item.averageScore)}
          </span>
        )}

        {/* Sits inside the <Link>; the button stops propagation itself. */}
        <FavoriteButton
          targetIri={item.iri}
          kind={item.kind}
          title={item.title}
          coverImage={item.coverImage}
        />
      </div>

      <div className="card__body">
        <h3 className="card__title" title={item.title}>
          {item.title}
        </h3>

        {item.subtitle && <p className="card__subtitle">{item.subtitle}</p>}

        <p className="card__meta">
          {item.status && (
            <>
              <span className={`dot dot--${item.status}`} aria-hidden="true" />
              {STATUS_LABELS[item.status]}
            </>
          )}
          {item.releaseLabel && <> · {item.releaseLabel}</>}
          {item.countLabel && <> · {item.countLabel}</>}
        </p>

        <ul className="card__genres">
          {item.genres.slice(0, 3).map((genre) => (
            <li key={genre['@id']} className="chip chip--ghost">
              {genre.name}
            </li>
          ))}
          {item.genres.length > 3 && <li className="chip chip--ghost">+{item.genres.length - 3}</li>}
        </ul>
      </div>
    </Link>
  )
}

/** Placeholder card shown while a page of results is loading. */
export function MediaCardSkeleton() {
  return (
    <div className="card card--skeleton" aria-hidden="true">
      <div className="card__cover skeleton" />
      <div className="card__body">
        <div className="skeleton skeleton--line" style={{ width: '80%' }} />
        <div className="skeleton skeleton--line skeleton--sm" style={{ width: '55%' }} />
        <div className="skeleton skeleton--line skeleton--sm" style={{ width: '70%' }} />
      </div>
    </div>
  )
}
