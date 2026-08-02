import { Link } from 'react-router-dom'
import { useRecommendations } from '../api/recommendations'
import { useGenreLabel } from '../api/queries'
import { useFavorites } from '../api/favorites'
import {
  RecommendationCard,
  RecommendationCardSkeleton,
} from '../components/RecommendationCard'
import { formatDate } from '../types/media'

/**
 * `/recommendations` — les suggestions personnalisées de l'utilisateur.
 *
 * ── Vide ≠ cassé ──────────────────────────────────────────────────────────
 * `GET /api/recommendations` renvoie **volontairement** une collection vide
 * quand le compte n'a aucun favori, au lieu de servir des titres arbitraires.
 * L'écran doit donc dire *pourquoi* c'est vide et *quoi faire* — d'où la
 * lecture des favoris en parallèle : « aucun favori » et « des favoris mais
 * aucune suggestion » sont deux situations différentes, et les confondre
 * enverrait l'utilisateur ajouter des favoris qu'il a déjà.
 */
export function RecommendationsPage() {
  const { entries, isLoading, isError, error, refetch, isFetching } = useRecommendations()
  const { entries: favorites, isLoading: favoritesLoading } = useFavorites()
  const genreLabel = useGenreLabel()

  // Toutes les recommandations d'un lot partagent le même `generatedAt` : le
  // provider les recalcule en bloc. La première suffit donc à dater le lot.
  const generatedAt = entries[0]?.generatedAt ?? null

  return (
    <div className="catalog">
      <header className="catalog__header">
        <div>
          <h1 className="catalog__title">Recommandations</h1>
          <p className="catalog__count">
            {isLoading
              ? 'Calcul en cours…'
              : entries.length === 0
                ? 'Aucune suggestion pour l’instant'
                : `${entries.length} suggestion${entries.length > 1 ? 's' : ''} classée${
                    entries.length > 1 ? 's' : ''
                  } par pertinence`}
            {generatedAt && formatDate(generatedAt) && (
              <> · calculées le {formatDate(generatedAt)}</>
            )}
          </p>
        </div>

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {isFetching ? 'Actualisation…' : 'Actualiser'}
        </button>
      </header>

      {isError ? (
        <div className="panel panel--error" role="alert">
          <h2>Impossible de charger vos recommandations</h2>
          <p>{error instanceof Error ? error.message : 'Erreur inconnue'}</p>
          <button type="button" className="btn" onClick={() => void refetch()}>
            Réessayer
          </button>
        </div>
      ) : isLoading ? (
        <div className="reco-list">
          {Array.from({ length: 4 }, (_, index) => (
            <RecommendationCardSkeleton key={index} />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState hasFavorites={favorites.length > 0} favoritesLoading={favoritesLoading} />
      ) : (
        <>
          <p className="reco-intro muted">
            Chaque suggestion est comparée à vos favoris genre par genre, les genres rares pesant
            plus lourd que les courants. Le pourcentage est le score renvoyé par l’API, pas une
            estimation de l’interface.
          </p>

          <div className="reco-list">
            {entries.map((entry, index) => (
              <RecommendationCard
                key={entry.iri || entry.targetIri}
                entry={entry}
                rank={index + 1}
                genreLabel={genreLabel}
              />
            ))}
          </div>
        </>
      )}

      {/* Rappel discret : le moteur ne part que des favoris. Affiché même quand
          la liste est pleine, parce que c'est le levier d'amélioration. */}
      {!isLoading && !isError && entries.length > 0 && (
        <p className="reco-footnote muted">
          Vos suggestions se recalculent à partir de vos{' '}
          <Link to="/favorites" className="link">
            {favorites.length} favori{favorites.length > 1 ? 's' : ''}
          </Link>
          . Ajoutez-en pour les affiner.
        </p>
      )}
    </div>
  )
}

function EmptyState({
  hasFavorites,
  favoritesLoading,
}: {
  hasFavorites: boolean
  favoritesLoading: boolean
}) {
  if (favoritesLoading) {
    return <p className="muted">Chargement…</p>
  }

  if (!hasFavorites) {
    return (
      <div className="panel panel--page empty">
        <h2>Ajoutez des favoris pour obtenir des recommandations</h2>
        <p className="muted">
          Le moteur part de ce que vous aimez déjà : il compare les genres de vos favoris à
          l’ensemble du catalogue. Sans aucun favori il n’a rien à comparer, et préfère ne rien
          proposer plutôt que de suggérer au hasard.
        </p>
        <p className="muted">Deux ou trois titres suffisent pour un premier classement utile.</p>
        <div className="row">
          <Link to="/" className="btn btn--primary">
            Parcourir le catalogue
          </Link>
          <Link to="/favorites" className="btn btn--ghost">
            Voir mes favoris
          </Link>
        </div>
      </div>
    )
  }

  // Cas rare mais réel : des favoris existent, et pourtant rien ne remonte —
  // par exemple si tous les titres proches sont déjà en favori, ou si les
  // genres des favoris sont absents du reste du catalogue.
  return (
    <div className="panel panel--page empty">
      <h2>Aucune suggestion pour le moment</h2>
      <p className="muted">
        Vos favoris sont bien pris en compte, mais le moteur n’a trouvé aucun titre à vous proposer
        — cela arrive quand les titres proches sont déjà tous dans vos favoris. Diversifiez vos
        favoris pour élargir le champ.
      </p>
      <div className="row">
        <Link to="/" className="btn btn--primary">
          Parcourir le catalogue
        </Link>
      </div>
    </div>
  )
}
