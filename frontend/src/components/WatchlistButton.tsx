import { useNavigate } from 'react-router-dom'
import { useMediaProgress, useSaveProgress } from '../api/progress'
import { useAuth } from '../auth/useAuth'
import type { MediaKind } from '../types/media'

type Props = {
  targetIri: string
  kind: MediaKind
  /** Rendu compact sur une carte, `full` avec libellé ailleurs. */
  variant?: 'sm' | 'full'
}

/**
 * Bouton « Suivre » / « Ajouter à ma liste » : crée (ou remet) une progression
 * au statut `PLANNED` sur le titre visé.
 *
 * Le libellé dit ce que l'action fait vraiment. « Regarder » a été réservé aux
 * liens sortants vers les plateformes officielles (voir `UnitList`), où le mot
 * est exact : ici, rien n'est diffusé, un titre est ajouté à une liste.
 *
 * Il n'y a **pas** de ressource « watchlist » dans le contrat. Le statut
 * `PLANNED` de `Progress` est exactement cette sémantique, il est déjà exposé
 * dans le sélecteur de la fiche, et il alimente la répartition du profil — le
 * réutiliser évite d'inventer un concept que le backend ne connaît pas.
 *
 * Le bouton reflète ce que sait déjà le cache `progress` : si le titre est
 * suivi avec un autre statut (en cours, terminé…), on ne l'écrase pas
 * silencieusement, on affiche le statut réel et on désactive l'action. Écraser
 * un « Terminé » par un « Prévu » parce que l'algorithme l'a re-suggéré serait
 * une perte de donnée utilisateur.
 */
export function WatchlistButton({ targetIri, kind, variant = 'sm' }: Props) {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const { entry } = useMediaProgress(targetIri)
  const save = useSaveProgress()

  const isPlanned = entry?.status === 'PLANNED'
  const isTrackedOtherwise = entry !== null && !isPlanned
  // Une carte de catalogue n'a pas la place d'une phrase ; une fiche, si — et
  // « Ajouter à ma liste » y lève toute ambiguïté sur ce que fait le bouton.
  const label = variant === 'full' ? 'Ajouter à ma liste' : 'Suivre'

  const handleClick = (event: React.MouseEvent) => {
    // Le bouton peut vivre dans un <Link> : ne jamais naviguer par accident.
    event.preventDefault()
    event.stopPropagation()

    if (!isAuthenticated) {
      navigate('/login', { state: { from: window.location.pathname } })
      return
    }
    if (isPlanned || isTrackedOtherwise || save.isPending) return

    save.mutate({
      targetIri,
      kind,
      status: 'PLANNED',
      // « Prévu » veut dire zéro progression : envoyer 0 prétendrait le
      // contraire, le contrat modélise « non renseigné » par null.
      currentEpisode: null,
      currentChapter: null,
      score: null,
      existing: entry,
    })
  }

  const text = isPlanned ? 'Dans votre liste' : isTrackedOtherwise ? 'Déjà suivi' : label

  return (
    <button
      type="button"
      className={`watchlist watchlist--${variant} ${isPlanned ? 'is-active' : ''}`}
      onClick={handleClick}
      disabled={isTrackedOtherwise}
      aria-pressed={isPlanned}
      title={
        isAuthenticated
          ? isTrackedOtherwise
            ? 'Ce titre est déjà dans votre suivi — modifiez-le depuis sa fiche'
            : text
          : 'Connectez-vous pour gérer votre liste'
      }
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="watchlist__icon">
        {isPlanned ? (
          <path d="M5 12.5 10 17.5 19 7" />
        ) : (
          <path d="M12 5v14M5 12h14" />
        )}
      </svg>
      <span>{save.isPending ? 'Ajout…' : text}</span>
    </button>
  )
}
