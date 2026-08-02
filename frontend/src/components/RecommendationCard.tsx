import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FavoriteButton } from './FavoriteButton'
import { WatchlistButton } from './WatchlistButton'
import type { RecommendationEntry } from '../api/recommendations'

type Props = {
  entry: RecommendationEntry
  /** Rang dans le classement, 1-indexé. */
  rank: number
  /** Traduit un slug de genre en libellé. Voir `useGenreLabel`. */
  genreLabel: (slug: string) => string
}

/** Le score est un ratio 0-1 ; l'utilisateur lit mieux un pourcentage. */
function percent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`
}

/**
 * Palier visuel du score. Les bornes sont calées sur la distribution réelle
 * observée (0,76 → 0,89 pour un compte avec deux favoris) : un dégradé sur
 * [0, 1] rendrait toutes les cartes identiques, puisque le moteur ne descend
 * jamais bas — il ne renvoie que ses meilleurs candidats.
 */
function scoreTone(score: number): string {
  if (score >= 0.85) return 'is-high'
  if (score >= 0.78) return 'is-mid'
  return 'is-low'
}

/**
 * Une suggestion : visuel du score, explication, et les deux actions directes.
 *
 * La carte n'est **pas** un `<Link>` englobant (contrairement à `MediaCard`) :
 * elle contient deux boutons et plusieurs liens de genre, et imbriquer des
 * contrôles interactifs dans un lien est invalide en HTML autant qu'hostile au
 * clavier. Le titre et la couverture portent la navigation.
 */
export function RecommendationCard({ entry, rank, genreLabel }: Props) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = Boolean(entry.coverImage) && !imageFailed

  const { reason } = entry
  // Les genres arrivent déjà classés par contribution décroissante ; les deux
  // premiers portent l'essentiel de l'explication, le reste est du bruit.
  const decisive = reason.genres.slice(0, 2)
  const extra = reason.genres.slice(2)

  return (
    <article className="reco">
      <div className="reco__cover">
        <Link to={entry.href} tabIndex={-1} aria-hidden="true">
          {showImage ? (
            <img
              src={entry.coverImage ?? ''}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="card__cover-fallback">
              <span>{entry.title.slice(0, 2).toUpperCase()}</span>
            </div>
          )}
        </Link>
        <span className="reco__rank">#{rank}</span>
      </div>

      <div className="reco__body">
        <div className="reco__head">
          <span className={`card__kind card__kind--${entry.kind}`}>
            {entry.kind === 'anime' ? 'Anime' : 'Manga'}
          </span>
          <h2 className="reco__title">
            <Link to={entry.href} className="link">
              {entry.title}
            </Link>
          </h2>
          {entry.subtitle && <p className="reco__subtitle">{entry.subtitle}</p>}
        </div>

        {/* ── Le score, rendu visible ──────────────────────────────────────
            Depuis le scoring v2 il discrimine réellement (cosinus pondéré par
            la rareté des genres), donc il mérite mieux qu'un nombre en petit.
            `role="img"` + `aria-label` : la barre est une information, pas une
            décoration, et un lecteur d'écran doit la restituer. */}
        <div className="reco__score">
          <div
            className={`reco__meter ${scoreTone(entry.score)}`}
            role="img"
            aria-label={`Pertinence ${percent(entry.score)}`}
          >
            <span className="reco__meter-fill" style={{ width: `${entry.score * 100}%` }} />
          </div>
          <span className="reco__score-value">{percent(entry.score)}</span>
        </div>

        {/* ── L'explication ───────────────────────────────────────────────── */}
        {decisive.length > 0 ? (
          <p className="reco__why">
            Parce que vous aimez{' '}
            {decisive.map((slug, index) => (
              <span key={slug}>
                {index > 0 && ' et '}
                <Link to={`/?genre=${encodeURIComponent(slug)}`} className="chip chip--link">
                  {genreLabel(slug)}
                </Link>
              </span>
            ))}
            {extra.length > 0 && (
              <span className="muted">
                {' '}
                (+ {extra.map(genreLabel).join(', ').toLowerCase()})
              </span>
            )}
          </p>
        ) : (
          // Le backend peut renvoyer un `reason` vide ou d'une stratégie qu'on
          // ne sait pas lire : mieux vaut l'avouer que d'afficher une phrase
          // creuse qui donnerait une fausse impression de personnalisation.
          <p className="reco__why muted">Suggestion issue de vos favoris.</p>
        )}

        {/* ── Le détail du score ──────────────────────────────────────────
            Affiché seulement si le backend l'a fourni : la v1 du moteur ne
            renvoyait aucune de ces trois métriques. */}
        {(reason.affinity !== null || reason.quality !== null || reason.popularity !== null) && (
          <dl className="reco__metrics">
            <Metric label="Affinité" value={reason.affinity} hint="Proximité avec vos favoris" />
            <Metric label="Qualité" value={reason.quality} hint="Note moyenne du titre" />
            <Metric label="Popularité" value={reason.popularity} hint="Audience du titre" />
          </dl>
        )}

        <div className="reco__actions">
          <FavoriteButton
            variant="full"
            targetIri={entry.targetIri}
            kind={entry.kind}
            title={entry.title}
            coverImage={entry.coverImage}
          />
          <WatchlistButton targetIri={entry.targetIri} kind={entry.kind} variant="full" />
        </div>
      </div>
    </article>
  )
}

function Metric({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  if (value === null) return null
  return (
    <div className="reco__metric" title={hint}>
      <dt className="reco__metric-label">{label}</dt>
      <dd className="reco__metric-value">
        <span className="reco__metric-bar">
          <span className="reco__metric-fill" style={{ width: `${value * 100}%` }} />
        </span>
        {percent(value)}
      </dd>
    </div>
  )
}

/** Squelette affiché pendant le premier chargement. */
export function RecommendationCardSkeleton() {
  return (
    <div className="reco reco--skeleton" aria-hidden="true">
      <div className="reco__cover skeleton" />
      <div className="reco__body">
        <div className="skeleton skeleton--line" style={{ width: '65%' }} />
        <div className="skeleton skeleton--line skeleton--sm" style={{ width: '40%' }} />
        <div className="skeleton skeleton--line skeleton--sm" style={{ width: '85%' }} />
      </div>
    </div>
  )
}
