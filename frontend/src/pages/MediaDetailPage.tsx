import { Link, useParams } from 'react-router-dom'
import { useMediaDetail } from '../api/queries'
import { ApiError } from '../api/client'
import { CommentThread } from '../components/CommentThread'
import { FavoriteButton } from '../components/FavoriteButton'
import { ProgressPanel } from '../components/ProgressPanel'
import {
  formatChapterNumber,
  formatDate,
  formatScore,
  STATUS_LABELS,
  type Chapter,
  type Episode,
  type MediaDetail,
  type MediaKind,
} from '../types/media'

/**
 * Detail page for both `/anime/:id` and `/manga/:id`.
 *
 * One component, because the two resources differ by three fields (season,
 * episodes vs chapters, volume count) and duplicating 200 lines for that would
 * guarantee the two pages drift apart.
 *
 * The episode/chapter list needs no request of its own: the item read group
 * (`*.item.read`) embeds it, which is why `useMediaDetail` hits the item
 * endpoint rather than reusing a catalogue entry from the cache.
 */
export function MediaDetailPage({ kind }: { kind: MediaKind }) {
  const { id } = useParams<{ id: string }>()
  const { data: media, isLoading, isError, error, refetch } = useMediaDetail(kind, id)

  if (isLoading) return <DetailSkeleton />

  // A 404 is a normal answer for a bad id and deserves its own screen, not the
  // generic "something broke" one.
  if (isError && error instanceof ApiError && error.status === 404) {
    return <NotFound kind={kind} id={id} />
  }

  if (isError || !media) {
    return (
      <div className="panel panel--error panel--page" role="alert">
        <h1>Impossible de charger cette fiche</h1>
        <p>{error instanceof Error ? error.message : 'Erreur inconnue'}</p>
        <div className="row">
          <button type="button" className="btn" onClick={() => void refetch()}>
            Réessayer
          </button>
          <Link to="/" className="btn btn--ghost">
            Retour au catalogue
          </Link>
        </div>
      </div>
    )
  }

  return <DetailView media={media} />
}

function DetailView({ media }: { media: MediaDetail }) {
  const isAnime = media.kind === 'anime'

  return (
    <article className="detail">
      <header
        className="detail__banner"
        style={
          media.bannerImage ? { backgroundImage: `url(${media.bannerImage})` } : undefined
        }
      >
        <div className="detail__banner-veil" />
      </header>

      <div className="detail__head">
        <div className="detail__cover">
          {media.coverImage ? (
            <img src={media.coverImage} alt="" loading="eager" />
          ) : (
            <div className="card__cover-fallback" aria-hidden="true">
              <span>{media.title.slice(0, 2).toUpperCase()}</span>
            </div>
          )}
        </div>

        <div className="detail__intro">
          <p className="detail__kind">
            <span className={`card__kind card__kind--${media.kind}`}>
              {isAnime ? 'Anime' : 'Manga'}
            </span>
          </p>

          <h1 className="detail__title">{media.title}</h1>

          {/* Both titles are shown: the card only had room for one. */}
          <p className="detail__titles">
            {media.titleRomaji !== media.title && <span>{media.titleRomaji}</span>}
            {media.titleEnglish && media.titleEnglish !== media.title && (
              <span>{media.titleEnglish}</span>
            )}
            {media.titleNative && <span lang="ja">{media.titleNative}</span>}
          </p>

          <ul className="detail__facts">
            {media.averageScore !== null && (
              <li>
                <span className="detail__fact-label">Score</span>
                <span className="detail__fact-value">{formatScore(media.averageScore)}/10</span>
              </li>
            )}
            {media.status && (
              <li>
                <span className="detail__fact-label">Statut</span>
                <span className="detail__fact-value">
                  <span className={`dot dot--${media.status}`} aria-hidden="true" />
                  {STATUS_LABELS[media.status]}
                </span>
              </li>
            )}
            {media.releaseLabel && (
              <li>
                <span className="detail__fact-label">{isAnime ? 'Saison' : 'Année'}</span>
                <span className="detail__fact-value">{media.releaseLabel}</span>
              </li>
            )}
            {media.unitCount !== null && (
              <li>
                <span className="detail__fact-label">{isAnime ? 'Épisodes' : 'Chapitres'}</span>
                <span className="detail__fact-value">{media.unitCount}</span>
              </li>
            )}
            {media.volumeCount !== null && (
              <li>
                <span className="detail__fact-label">Tomes</span>
                <span className="detail__fact-value">{media.volumeCount}</span>
              </li>
            )}
            {formatDate(media.startDate) && (
              <li>
                <span className="detail__fact-label">Début</span>
                <span className="detail__fact-value">{formatDate(media.startDate)}</span>
              </li>
            )}
            {formatDate(media.endDate) && (
              <li>
                <span className="detail__fact-label">Fin</span>
                <span className="detail__fact-value">{formatDate(media.endDate)}</span>
              </li>
            )}
          </ul>

          <div className="detail__actions">
            <FavoriteButton
              variant="full"
              targetIri={media.iri}
              kind={media.kind}
              title={media.title}
              coverImage={media.coverImage}
            />
          </div>

          {media.genres.length > 0 && (
            <ul className="detail__genres">
              {media.genres.map((genre) => (
                <li key={genre['@id']}>
                  {/* Clicking a genre goes back to the catalogue, pre-filtered.
                      The catalogue reads its filters from the query string. */}
                  <Link to={`/?genre=${encodeURIComponent(genre.slug)}`} className="chip chip--link">
                    {genre.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="detail__body">
        <div className="detail__main">
          <section className="panel">
            <h2 className="section__title">Synopsis</h2>
            {media.synopsis ? (
              <p className="detail__synopsis">{media.synopsis}</p>
            ) : (
              <p className="muted">Aucun synopsis disponible.</p>
            )}
          </section>

          {isAnime ? (
            <EpisodeList episodes={media.episodes} announced={media.unitCount} />
          ) : (
            <ChapterList chapters={media.chapters} announced={media.unitCount} />
          )}

          <CommentThread kind={media.kind} targetIri={media.iri} />
        </div>

        <aside className="detail__aside">
          <ProgressPanel media={media} />
        </aside>
      </div>
    </article>
  )
}

function EpisodeList({ episodes, announced }: { episodes: Episode[]; announced: number | null }) {
  return (
    <section className="panel">
      <h2 className="section__title">
        Épisodes {episodes.length > 0 && <span className="section__count">{episodes.length}</span>}
      </h2>

      {episodes.length === 0 ? (
        <p className="muted">
          {announced
            ? `${announced} épisodes annoncés, mais aucun n’est encore référencé dans la base.`
            : 'Aucun épisode référencé.'}
        </p>
      ) : (
        <ul className="unit-list">
          {episodes.map((episode) => (
            <li key={episode['@id']} className="unit">
              <span className="unit__number">{episode.number}</span>
              <span className="unit__title">{episode.title || `Épisode ${episode.number}`}</span>
              <span className="unit__meta">
                {episode.duration ? `${episode.duration} min` : null}
                {episode.duration && episode.airDate ? ' · ' : null}
                {formatDate(episode.airDate)}
              </span>
              {episode.streamUrl && (
                <a
                  className="btn btn--link"
                  href={episode.streamUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Voir
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ChapterList({ chapters, announced }: { chapters: Chapter[]; announced: number | null }) {
  return (
    <section className="panel">
      <h2 className="section__title">
        Chapitres {chapters.length > 0 && <span className="section__count">{chapters.length}</span>}
      </h2>

      {chapters.length === 0 ? (
        <p className="muted">
          {announced
            ? `${announced} chapitres annoncés, mais aucun n’est encore référencé dans la base.`
            : 'Aucun chapitre référencé.'}
        </p>
      ) : (
        <ul className="unit-list">
          {chapters.map((chapter) => (
            <li key={chapter['@id']} className="unit">
              {/* `number` is a decimal serialised as a string: "12.50" must
                  render as "12.5", never as "13". */}
              <span className="unit__number">{formatChapterNumber(chapter.number)}</span>
              <span className="unit__title">
                {chapter.title || `Chapitre ${formatChapterNumber(chapter.number)}`}
              </span>
              <span className="unit__meta">
                {chapter.pageCount ? `${chapter.pageCount} p.` : null}
                {chapter.pageCount && chapter.releaseDate ? ' · ' : null}
                {formatDate(chapter.releaseDate)}
              </span>
              {chapter.readUrl && (
                <a
                  className="btn btn--link"
                  href={chapter.readUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Lire
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function NotFound({ kind, id }: { kind: MediaKind; id: string | undefined }) {
  return (
    <div className="panel panel--page">
      <span className="badge">404</span>
      <h1>{kind === 'anime' ? 'Anime introuvable' : 'Manga introuvable'}</h1>
      <p>
        Aucune ressource ne correspond à <code>#{id}</code>.
      </p>
      <Link to="/" className="btn">
        Retour au catalogue
      </Link>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="detail" aria-hidden="true">
      <div className="detail__banner skeleton" />
      <div className="detail__head">
        <div className="detail__cover skeleton" />
        <div className="detail__intro">
          <div className="skeleton skeleton--line" style={{ width: '60%', height: 32 }} />
          <div className="skeleton skeleton--line skeleton--sm" style={{ width: '40%' }} />
          <div className="skeleton skeleton--line skeleton--sm" style={{ width: '75%' }} />
        </div>
      </div>
      <div className="detail__body">
        <div className="detail__main">
          <div className="panel">
            <div className="skeleton skeleton--line" style={{ width: '100%' }} />
            <div className="skeleton skeleton--line" style={{ width: '95%' }} />
            <div className="skeleton skeleton--line" style={{ width: '70%' }} />
          </div>
        </div>
      </div>
    </div>
  )
}
