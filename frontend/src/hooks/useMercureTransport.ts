/**
 * Le *transport* Mercure, sans aucune sémantique métier : où joindre le hub, et
 * avec quoi s'y authentifier.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 * Tout ceci vivait dans `useNotificationStream`, seul consommateur à l'époque.
 * Le fil de commentaires s'abonne désormais lui aussi — à un topic tout autre,
 * partagé par œuvre — et il lui faut exactement les mêmes réponses : quelle URL
 * de hub, cookie ou paramètre d'URL, quel jeton, et renouvelé quand ?
 * Dupliquer cette mécanique aurait signifié deux jetons renouvelés
 * indépendamment, et deux façons de se tromper.
 *
 * Le jeton, lui, reste unique : `useMercureSubscription` est une requête React
 * Query, donc les deux abonnés partagent la même entrée de cache et le même
 * cycle de renouvellement, quel que soit le nombre de composants montés.
 */
import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { MERCURE_URL } from '../config'
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

export function subscriptionQueryKey(userIri: string | null) {
  return ['mercure-subscription', userIri] as const
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

export type MercureTransport = {
  /** URL du hub, `null` si aucun n'est joignable — le temps réel est alors inerte. */
  hubUrl: string | null
  /** Envoyer le cookie `mercureAuthorization` au hub. */
  withCredentials: boolean
  /** Repli `?authorization=` quand le cookie ne peut pas atteindre le hub. */
  authorization: string | null
  /** Faux pour un visiteur anonyme : le hub refuse l'accès anonyme. */
  enabled: boolean
  userIri: string | null
  /** Topic personnel annoncé par le backend, seule source cohérente avec le jeton. */
  personalTopic: string | null
  /** À appeler quand le hub devient injoignable : le jeton est peut-être refusé. */
  renew: () => void
}

export function useMercureTransport(): MercureTransport {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userIri = user?.iri ?? null
  const enabled = userIri !== null

  const { data: subscription } = useMercureSubscription(enabled, userIri)

  /**
   * `EventSource` n'accepte aucun en-tête : le jeton passe par le cookie
   * `mercureAuthorization` (recommandé, et ce que l'infra a câblé) ou, à
   * défaut, par `?authorization=`. Un cookie posé en JS n'atteint que les
   * hôtes du même site — au-delà, seul le paramètre d'URL reste possible,
   * avec l'exposition du jeton dans les journaux que cela implique.
   */
  const useCookie = subscription ? hubAcceptsDocumentCookie(subscription.hubUrl) : false

  // Écrire dans `document.cookie` est un effet de bord : il n'a rien à faire
  // dans le corps d'un composant, que React peut rendre deux fois.
  useEffect(() => {
    if (!subscription || !useCookie) return
    installSubscriberCookie(subscription)
  }, [subscription, useCookie])

  // Stable : l'appelant la place en dépendance d'un `useEffect`, qu'une
  // nouvelle identité à chaque rendu ferait rejouer sans raison.
  const renew = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: subscriptionQueryKey(userIri) })
  }, [queryClient, userIri])

  return {
    // Le hub sait mieux que `VITE_MERCURE_URL` où il est joignable : il annonce
    // son URL publique avec le jeton. L'env var reste le repli.
    hubUrl: subscription?.hubUrl || MERCURE_URL || null,
    withCredentials: useCookie,
    authorization: subscription && !useCookie ? subscription.token : null,
    enabled,
    userIri,
    personalTopic: subscription?.topic ?? null,
    renew,
  }
}
