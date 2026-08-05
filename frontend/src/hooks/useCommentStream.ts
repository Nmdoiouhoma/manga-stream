/**
 * Garde le fil de commentaires d'une fiche à jour, sans rechargement.
 *
 * ── Le trou que cela comble ───────────────────────────────────────────────
 * Jusqu'ici, un fil ouvert ne bougeait que pour une seule personne au monde :
 * celle à qui on venait de répondre. C'était un effet de bord de la cloche —
 * la notification `COMMENT_REPLY` invalidait au passage `['comments']`. Tous
 * les autres visiteurs de la même fiche, et tous les commentaires racines,
 * restaient invisibles jusqu'au prochain F5.
 *
 * Le backend publie désormais sur un topic scopé par œuvre
 * (`App\Service\Comment\CommentTopics`), en **public** — le fil est une donnée
 * partagée, contrairement aux notifications. Ce hook s'y abonne.
 *
 * ── Aussi bête que son voisin, et pour la même raison ─────────────────────
 * On invalide, on ne fusionne pas. Le message porte pourtant le commentaire
 * complet en JSON-LD, mais l'insérer à la main dupliquerait la reconstruction
 * du fil (`buildThread`) et ferait diverger l'affichage selon le chemin
 * emprunté. Un aller-retour vaut mieux que deux vérités.
 *
 * ── Ce qui reste hors de portée ───────────────────────────────────────────
 * Le hub refuse l'accès anonyme : un visiteur déconnecté ne reçoit rien et
 * garde le comportement d'avant — le fil au chargement, et au
 * rafraîchissement. Ce n'est pas une panne, c'est la conséquence assumée de
 * n'émettre de jeton abonné qu'aux comptes connectés.
 */
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useMercure, type MercureStatus } from './useMercure'
import { useMercureTransport } from './useMercureTransport'
import { commentsQueryKey } from '../api/comments'
import { idFromIri, type MediaKind } from '../types/media'

/**
 * Topic du fil, tel que le backend le publie.
 *
 * Reconstruit depuis le type et l'identifiant plutôt que par concaténation de
 * l'IRI : le gabarit du backend est ainsi recopié en toutes lettres ici, et un
 * écart entre les deux conventions se lit à l'œil au lieu de se manifester par
 * un fil qui ne bouge jamais.
 */
export function commentTopicFor(kind: MediaKind, targetIri: string | undefined): string | null {
  if (!targetIri) return null
  const id = idFromIri(targetIri)
  if (id === null) return null

  return kind === 'anime' ? `/api/animes/${id}/comments` : `/api/mangas/${id}/comments`
}

export function useCommentStream(kind: MediaKind, targetIri: string | undefined): MercureStatus {
  const queryClient = useQueryClient()
  const { hubUrl, withCredentials, authorization, enabled } = useMercureTransport()

  const topic = commentTopicFor(kind, targetIri)

  const onMessage = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: commentsQueryKey(targetIri) })
  }, [queryClient, targetIri])

  return useMercure({
    hubUrl,
    topics: topic ? [topic] : [],
    onMessage,
    enabled: enabled && topic !== null,
    withCredentials,
    authorization,
  })
}
