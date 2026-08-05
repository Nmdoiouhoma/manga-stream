import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useFavorites } from '../api/favorites'
import { PROGRESS_STATUS_LABELS, PROGRESS_STATUSES, useProgressList } from '../api/progress'
import { useUpdateProfile } from '../api/profile'
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

      <ProfileEditor />

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

      <section className="panel" id="repartition">
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
 * Édition du compte : pseudo, adresse, mot de passe.
 *
 * ── Replié par défaut ─────────────────────────────────────────────────────
 * Le profil se consulte bien plus souvent qu'il ne se modifie. Un formulaire
 * déployé en permanence donnerait à la page l'allure d'un écran de réglages,
 * alors qu'on y vient pour ses statistiques.
 *
 * ── Changer d'adresse déconnecte, et on le dit avant ──────────────────────
 * L'identifiant de connexion est l'adresse : la modifier périme le jeton en
 * cours (vérifié côté backend, voir `api/profile.ts`). Plutôt que de laisser
 * l'application se déconnecter d'elle-même une requête plus tard, on annonce
 * la reconnexion, puis on redirige vers l'écran de connexion avec le motif.
 */
function ProfileEditor() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const update = useUpdateProfile()

  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState(user?.username ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [saved, setSaved] = useState(false)

  if (!user) return null

  const emailWillChange = email.trim() !== user.email
  const wantsNewPassword = nextPassword.length > 0

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setSaved(false)

    update.mutate(
      {
        username: username.trim(),
        email: email.trim(),
        ...(wantsNewPassword
          ? { password: { current: currentPassword, next: nextPassword } }
          : {}),
      },
      {
        onSuccess: (result) => {
          setCurrentPassword('')
          setNextPassword('')

          if (result.requiresReauthentication) {
            logout()
            navigate('/login', {
              replace: true,
              state: {
                notice:
                  'Votre adresse e-mail a changé. Elle sert d’identifiant : reconnectez-vous avec la nouvelle.',
              },
            })
            return
          }

          setSaved(true)
        },
      },
    )
  }

  if (!open) {
    return (
      <section className="panel profile__editor">
        <div>
          <h2 className="section__title">Mon compte</h2>
          <p className="muted">Pseudo, adresse e-mail et mot de passe.</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>
          Modifier
        </button>
      </section>
    )
  }

  return (
    <section className="panel">
      <h2 className="section__title">Mon compte</h2>

      <form className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field__label">Pseudo</span>
          <input
            className="input"
            type="text"
            autoComplete="username"
            required
            minLength={3}
            maxLength={50}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">Adresse e-mail</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        {emailWillChange && (
          <p className="notice notice--warn" role="status">
            L’adresse sert d’identifiant de connexion : la changer met fin à cette
            session, et il faudra vous reconnecter avec la nouvelle.
          </p>
        )}

        <fieldset className="fieldset">
          <legend className="field__label">Nouveau mot de passe</legend>
          <p className="muted">Laissez vide pour le conserver.</p>

          <label className="field">
            <span className="field__label">Nouveau mot de passe</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
            />
          </label>

          {wantsNewPassword && (
            <label className="field">
              <span className="field__label">Mot de passe actuel</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
          )}
        </fieldset>

        {update.isError && (
          <p className="form__error" role="alert">
            {update.error instanceof Error ? update.error.message : 'Modification impossible'}
          </p>
        )}

        {saved && (
          <p className="notice" role="status">
            Profil mis à jour.
          </p>
        )}

        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={update.isPending}>
            {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setOpen(false)
              setUsername(user.username)
              setEmail(user.email)
              setCurrentPassword('')
              setNextPassword('')
              setSaved(false)
              update.reset()
            }}
          >
            Annuler
          </button>
        </div>
      </form>
    </section>
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
