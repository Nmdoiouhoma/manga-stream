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
 * ── Dégradation ───────────────────────────────────────────────────────────
 * Chaque maillon peut manquer sans casser l'application : pas de hub
 * configuré, pas de jeton abonné (backend antérieur, ou émission en échec —
 * le listener omet alors volontairement la clé), hub injoignable. Dans tous
 * les cas la cloche continue de fonctionner au rafraîchissement.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMercure, type MercureStatus } from './useMercure'
import { useAuth } from '../auth/useAuth'
import { MERCURE_URL, mercureTopicsFor } from '../config'
import { notificationsQueryKey } from '../api/notifications'
import {
  fetchMercureSubscription,
  hubAcceptsDocumentCookie,
  installSubscriberCookie,
  isSubscriptionExpired,
  millisecondsUntilExpiry,
  type MercureSubscription,
} from '../api/mercure'
import { getSession } from '../auth/session'

/** Marge avant expiration en deçà de laquelle le jeton est renouvelé. */
const RENEW_MARGIN_MS = 60_000
/** Plancher, pour ne pas boucler sur un jeton de très courte durée. */
const MIN_RENEW_INTERVAL_MS = 30_000

function subscriptionQueryKey(userIri: string | null) {
  return ['mercure-subscription', userIri] as const
}

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

/**
 * L'abonnement courant : celui reçu à la connexion tant qu'il est valide,
 * sinon un neuf demandé au backend.
 *
 * `refetchInterval` est calé sur l'expiration du jeton plutôt que sur un
 * intervalle fixe : le hub coupe la connexion quand le jeton meurt, et se
 * réveiller *après* la coupure ferait perdre des événements le temps du
 * renouvellement.
 */
function useMercureSubscription(enabled: boolean, userIri: string | null) {
  return useQuery<MercureSubscription | null>({
    queryKey: subscriptionQueryKey(userIri),
    enabled: enabled && userIri !== null,
    // Réessayer immédiatement ne sert à rien : soit l'endpoint n'existe pas
    // encore, soit le backend a un souci. Le `refetchInterval` reprend la main.
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const subscription = query.state.data
      if (!subscription) return MIN_RENEW_INTERVAL_MS * 4
      const remaining = millisecondsUntilExpiry(subscription)
      if (remaining === null) return false // Jeton sans `exp` : rien à renouveler.
      return Math.max(MIN_RENEW_INTERVAL_MS, remaining - RENEW_MARGIN_MS)
    },
    queryFn: async () => {
      const session = getSession()
      if (!session) return null

      // Celui de la connexion, s'il a encore de la marge : évite un appel
      // réseau au démarrage, ce qui est tout l'intérêt de l'avoir reçu là.
      const fromLogin = session.mercure
      if (fromLogin && !isSubscriptionExpired(fromLogin, RENEW_MARGIN_MS / 1000)) {
        return fromLogin
      }

      return fetchMercureSubscription(session.token)
    },
  })
}

export function useNotificationStream(): MercureStatus {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userIri = user?.iri ?? null
  const isAuthenticated = userIri !== null

  const { data: subscription } = useMercureSubscription(isAuthenticated, userIri)

  // Le hub sait mieux que `VITE_MERCURE_URL` où il est joignable : il annonce
  // son URL publique avec le jeton. L'env var reste le repli.
  const hubUrl = subscription?.hubUrl || MERCURE_URL || null

  /**
   * `EventSource` n'accepte aucun en-tête : le jeton passe par le cookie
   * `mercureAuthorization` (recommandé, et ce que l'infra a câblé) ou, à
   * défaut, par `?authorization=`. Un cookie posé en JS n'atteint que les
   * hôtes du même site — au-delà, seul le paramètre d'URL reste possible,
   * avec l'exposition du jeton dans les journaux que cela implique.
   */
  const useCookie = subscription ? hubAcceptsDocumentCookie(subscription.hubUrl) : false
  const authorization = subscription && !useCookie ? subscription.token : null

  // Écrire dans `document.cookie` est un effet de bord : il n'a rien à faire
  // dans le corps d'un composant, que React peut rendre deux fois.
  useEffect(() => {
    if (!subscription || !useCookie) return
    installSubscriberCookie(subscription)
  }, [subscription, useCookie])

  /**
   * Le topic vient du backend quand un abonnement existe — il est alors
   * cohérent par construction avec le claim `mercure.subscribe` du jeton.
   * Sans abonnement, repli sur la convention configurée, qui reste soumise au
   * garde-fou « tout topic doit être cloisonné par utilisateur ».
   */
  const topics = subscription ? [subscription.topic] : mercureTopicsFor(userIri, user?.id ?? null)

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
    enabled: isAuthenticated,
    withCredentials: useCookie,
    authorization,
  })

  /**
   * Un hub devenu injoignable est souvent le symptôme d'un jeton refusé (401),
   * qu'`EventSource` ne distingue pas d'une coupure réseau. On redemande donc
   * un abonnement — **une seule fois** par passage en `unavailable`, sinon un
   * hub éteint ferait boucler les requêtes vers le backend.
   */
  const retriedRef = useRef(false)
  useEffect(() => {
    if (status !== 'unavailable') {
      retriedRef.current = false
      return
    }
    if (retriedRef.current || !isAuthenticated) return
    retriedRef.current = true
    void queryClient.invalidateQueries({ queryKey: subscriptionQueryKey(userIri) })
  }, [status, isAuthenticated, queryClient, userIri])

  return status
}
