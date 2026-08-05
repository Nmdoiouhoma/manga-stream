/**
 * Branche le flux Mercure sur le cache React Query des notifications.
 *
 * ── Ce qui a changé depuis la phase 2 ─────────────────────────────────────
 * Le transport était prouvé avec un jeton que le front **forgeait lui-même**,
 * ce qui supposait le secret HS256 dans le navigateur. Le hub refuse désormais
 * l'accès anonyme et c'est le backend qui émet le jeton abonné, restreint au
 * seul topic personnel du porteur. Vérifié de bout en bout le 2026-08-02 :
 * abonnement avec le jeton du backend, réponse d'un autre compte à un
 * commentaire, réception de la notification `COMMENT_REPLY` — un événement
 * réellement émis par le backend, pas forgé.
 *
 * ── Volontairement bête ───────────────────────────────────────────────────
 * Quoi qu'envoie le hub, la réaction est « invalider la requête notifications
 * et laisser l'API faire foi ». Le backend publie pourtant la représentation
 * JSON-LD complète de la ressource, qu'on pourrait injecter directement dans
 * le cache — mais cela dupliquerait la normalisation et ferait diverger
 * l'affichage selon qu'une notification est arrivée par SSE ou par HTTP. Un
 * aller-retour de plus est un prix acceptable pour n'avoir qu'un chemin de
 * lecture.
 *
 * ── Le fil de commentaires n'est plus de son ressort ──────────────────────
 * Ce hook invalidait aussi `['comments']` sur réception d'un `COMMENT_REPLY`,
 * faute de mieux : c'était le seul événement qui traversait le hub. Cela ne
 * couvrait que le destinataire de la réponse, jamais les autres visiteurs de
 * la fiche, et jamais les commentaires racines. Le fil a maintenant son propre
 * abonnement, scopé par œuvre — voir {@link useCommentStream}.
 *
 * ── Dégradation ───────────────────────────────────────────────────────────
 * Chaque maillon peut manquer sans casser l'application : pas de hub
 * configuré, pas de jeton abonné (backend antérieur, ou émission en échec —
 * le listener omet alors volontairement la clé), hub injoignable. Dans tous
 * les cas la cloche continue de fonctionner au rafraîchissement.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useMercure, type MercureStatus } from './useMercure'
import { useMercureTransport } from './useMercureTransport'
import { useAuth } from '../auth/useAuth'
import { mercureTopicsFor } from '../config'
import { notificationsQueryKey } from '../api/notifications'

/** Lit `data.user`, que ce soit une IRI ou un objet embarqué. */
function ownerIriOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  const user = record.user
  if (typeof user === 'string') return user
  if (typeof user === 'object' && user !== null) {
    const iri = (user as Record<string, unknown>)['@id']
    if (typeof iri === 'string') return iri
  }
  return null
}

export function useNotificationStream(): MercureStatus {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { hubUrl, withCredentials, authorization, enabled, userIri, personalTopic, renew } =
    useMercureTransport()

  /**
   * Le topic vient du backend quand un abonnement existe — il est alors
   * cohérent par construction avec le claim `mercure.subscribe` du jeton.
   * Sans abonnement, repli sur la convention configurée, qui reste soumise au
   * garde-fou « tout topic doit être cloisonné par utilisateur ».
   */
  const topics = personalTopic ? [personalTopic] : mercureTopicsFor(userIri, user?.id ?? null)

  const onMessage = useCallback(
    (data: unknown) => {
      const owner = ownerIriOf(data)
      // Propriétaire connu et différent du nôtre → pas pour nous, quel qu'ait
      // été le topic. Défense en profondeur : avec un jeton correctement scopé
      // et des publications privées, ce cas ne doit jamais se produire.
      if (owner !== null && userIri !== null && owner !== userIri) return
      void queryClient.invalidateQueries({ queryKey: notificationsQueryKey(userIri) })
    },
    [queryClient, userIri],
  )

  const status = useMercure({
    hubUrl,
    topics,
    onMessage,
    enabled,
    withCredentials,
    authorization,
  })

  /**
   * Un hub devenu injoignable est souvent le symptôme d'un jeton refusé (401),
   * qu'`EventSource` ne distingue pas d'une coupure réseau. On redemande donc
   * un abonnement — **une seule fois** par passage en `unavailable`, sinon un
   * hub éteint ferait boucler les requêtes vers le backend.
   *
   * Ce renouvellement n'est déclenché qu'ici, bien que le fil de commentaires
   * partage le même jeton : les deux abonnements tombent ensemble puisqu'ils
   * tombent pour la même raison, et deux relances simultanées doubleraient les
   * requêtes sans rien réparer de plus.
   */
  const retriedRef = useRef(false)
  useEffect(() => {
    if (status !== 'unavailable') {
      retriedRef.current = false
      return
    }
    if (retriedRef.current || !enabled) return
    retriedRef.current = true
    renew()
  }, [status, enabled, renew])

  return status
}
