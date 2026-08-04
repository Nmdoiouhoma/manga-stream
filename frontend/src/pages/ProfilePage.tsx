import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useFavorites } from '../api/favorites'
import { PROGRESS_STATUS_LABELS, PROGRESS_STATUSES, useProgressList } from '../api/progress'
import { formatChapterNumber, formatDate } from '../types/media'

/**
 * Account page: identity plus a few honest statistics computed from the user's
 * own progress and favourites — no dedicated stats endpoint exists in the
 * contract, and inventing one client-side beyond simple counting would be
 * making things up.
 */
export function ProfilePage() {
  const { user, logout } = useAuth()
  const { entries: favorites, isLoading: favoritesLoading } = useFavorites()
  const { entries: progress, isLoading: progressLoading } = useProgressList()

  if (!user) return null // `RequireAuth` guarantees this never renders.

  const byStatus = PROGRESS_STATUSES.map((status) => ({
    status,
    count: progress.filter((entry) => entry.status === status).length,
  }))

  const scored = progress.filter((entry) => entry.score !== null)
  const averageScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, entry) => sum + (entry.score ?? 0), 0) / scored.length)
      : null

  const episodesWatched = progress.reduce((sum, entry) => sum + (entry.currentEpisode ?? 0), 0)
  // `currentChapter` is already parsed from the contract's decimal string.
  const chaptersRead = progress.reduce((sum, entry) => sum + (entry.currentChapter ?? 0), 0)

  return (
    <div className="profile">
      <header className="catalog__header">
        <h1 className="catalog__title">Profil</h1>
      </header>

      <section className="panel profile__identity">
        <div className="profile__avatar" aria-hidden="true">
          {user.username.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h2 className="profile__name">{user.username}</h2>
          <p className="muted">{user.email}</p>
          <p className="muted profile__roles">
            {user.roles.map((role) => (
              <span key={role} className="chip chip--ghost">
                {role}
              </span>
            ))}
          </p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={logout}>
          Se déconnecter
        </button>
      </section>

      <RecommendationTeaser favoriteCount={favorites.length} />

      <section className="stats">
        <Stat label="Favoris" value={favoritesLoading ? '…' : String(favorites.length)} />
        <Stat label="Titres suivis" value={progressLoading ? '…' : String(progress.length)} />
        <Stat
          label="Épisodes vus"
          value={progressLoading ? '…' : String(episodesWatched)}
        />
        <Stat
          label="Chapitres lus"
          value={progressLoading ? '…' : formatChapterNumber(chaptersRead)}
        />
        <Stat
          label="Note moyenne"
          value={progressLoading ? '…' : averageScore !== null ? `${averageScore}/100` : '—'}
        />
      </section>

      <section className="panel">
        <h2 className="section__title">Répartition par statut</h2>
        {progressLoading ? (
          <p className="muted">Chargement…</p>
        ) : progress.length === 0 ? (
          <p className="muted">
            Aucun suivi pour l’instant. Ouvrez une fiche et renseignez votre progression.
          </p>
        ) : (
          <ul className="status-list">
            {byStatus.map(({ status, count }) => (
              <li key={status} className="status-list__row">
                {/* Chaque barre mène à son onglet de « Ma liste » : c'est ici
                    qu'on constate « 12 en pause », et l'action qui suit est
                    toujours d'aller les voir. */}
                <Link to={`/list?statut=${status}`} className="status-list__label link">
                  {PROGRESS_STATUS_LABELS[status]}
                </Link>
                <span className="status-list__bar">
                  <span
                    className="status-list__fill"
                    style={{ width: `${progress.length > 0 ? (count / progress.length) * 100 : 0}%` }}
                  />
                </span>
                <span className="status-list__count">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2 className="section__title">
          Activité récente
          {progress.length > 0 && (
            <Link to="/list" className="link section__aside">
              Voir toute ma liste
            </Link>
          )}
        </h2>
        {progressLoading ? (
          <p className="muted">Chargement…</p>
        ) : progress.length === 0 ? (
          <p className="muted">Rien à afficher.</p>
        ) : (
          <ul className="unit-list">
            {progress.slice(0, 8).map((entry) => (
              <li key={entry.iri || entry.targetIri} className="unit">
                <span className="unit__number">
                  {entry.kind === 'anime'
                    ? (entry.currentEpisode ?? '—')
                    : formatChapterNumber(entry.currentChapter)}
                </span>
                <span className="unit__title">
                  <Link to={entry.href} className="link">
                    {entry.targetTitle || entry.targetIri}
                  </Link>
                </span>
                <span className="unit__meta">
                  {PROGRESS_STATUS_LABELS[entry.status]}
                  {entry.updatedAt ? ` · ${formatDate(entry.updatedAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/**
 * Passerelle vers `/recommendations` depuis le profil.
 *
 * Elle n'appelle **pas** `useRecommendations()` : le profil ne doit pas
 * déclencher un recalcul côté serveur juste pour afficher un encart. Le nombre
 * de favoris, déjà chargé par la page, suffit à écrire le bon message.
 */
function RecommendationTeaser({ favoriteCount }: { favoriteCount: number }) {
  return (
    <section className="panel panel--soft profile__reco">
      <div>
        <h2 className="section__title">Recommandations</h2>
        <p className="muted">
          {favoriteCount === 0
            ? 'Ajoutez quelques favoris et le moteur vous proposera des titres proches, genre par genre.'
            : `Calculées à partir de vos ${favoriteCount} favori${favoriteCount > 1 ? 's' : ''}, avec le détail de ce qui a pesé dans chaque suggestion.`}
        </p>
      </div>
      <Link to="/recommendations" className="btn btn--primary">
        Voir mes recommandations
      </Link>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  )
}
