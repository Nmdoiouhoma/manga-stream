/**
 * Abonnement Mercure : récupérer le **JWT abonné émis par le backend**, et le
 * transmettre au hub d'une façon qu'`EventSource` accepte.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 * En phase 2, le front forgeait lui-même un jeton Mercure pour prouver que le
 * transport SSE fonctionnait. Ce n'était pas défendable : cela supposait le
 * secret HS256 côté navigateur. Depuis le 2026-08-02 le hub refuse l'accès
 * anonyme (`MERCURE_ALLOW_ANONYMOUS=false`) et le backend émet un jeton dont
 * le claim `mercure.subscribe` ne contient **que** le topic personnel du
 * porteur — vérifié sur un jeton réel :
 *
 *   { "exp": …, "mercure": { "publish": [], "subscribe": ["/api/users/18/notifications"] } }
 *
 * ── Deux sources, dans cet ordre ──────────────────────────────────────────
 *  1. la réponse de `POST /api/login`, qui embarque l'abonnement sous la clé
 *     `mercure` — zéro requête supplémentaire au démarrage ;
 *  2. `GET /api/mercure/subscription`, pour le **renouvellement** : le jeton
 *     abonné expire indépendamment du JWT d'API, et une session restaurée
 *     depuis le `localStorage` peut porter un jeton Mercure déjà mort.
 *
 * ── Validation, malgré le typage ──────────────────────────────────────────
 * Les deux sources passent par `parseMercureSubscription`. Pour l'endpoint
 * dédié, désormais décrit par le contrat (régénéré le 2026-08-02 09:00), le
 * client typé garantit déjà la forme *à la compilation* — la validation reste
 * parce qu'un abonnement incomplet doit dégrader proprement plutôt que de
 * produire une souscription silencieusement cassée. Pour le bloc `mercure` de
 * la réponse de login, elle est en revanche indispensable : le backend l'omet
 * volontairement quand l'émission du jeton échoue.
 */
import { apiClient } from './client'
import { decodeJwt } from '../auth/session'

/** Tout ce dont le navigateur a besoin pour ouvrir son flux. */
export type MercureSubscription = {
  /** URL publique du hub, joignable depuis le navigateur. */
  hubUrl: string
  /** Unique topic couvert par le jeton, ex. `/api/users/42/notifications`. */
  topic: string
  /** JWT abonné, signé par le backend. */
  token: string
}

/**
 * Valide une charge utile inconnue. Renvoie `null` dès qu'un champ manque :
 * un abonnement incomplet est inutilisable, et le tolérer produirait une
 * souscription silencieusement cassée plutôt qu'une dégradation visible.
 */
export function parseMercureSubscription(value: unknown): MercureSubscription | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>

  const hubUrl = typeof record.hubUrl === 'string' ? record.hubUrl.trim() : ''
  const topic = typeof record.topic === 'string' ? record.topic.trim() : ''
  const token = typeof record.token === 'string' ? record.token.trim() : ''

  if (!hubUrl || !topic || !token) return null
  return { hubUrl, topic, token }
}

/**
 * Extrait l'abonnement de la réponse de `POST /api/login`.
 *
 * Le contrat décrit désormais la clé `mercure` comme **optionnelle**, ce qui
 * est exact : le listener backend l'omet quand l'émission du jeton échoue
 * (l'échec est journalisé côté serveur et ne doit pas empêcher de se
 * connecter). Son absence est donc un cas nominal, pas une erreur.
 */
export function subscriptionFromLogin(payload: unknown): MercureSubscription | null {
  if (typeof payload !== 'object' || payload === null) return null
  return parseMercureSubscription((payload as Record<string, unknown>).mercure)
}

/**
 * Renouvelle l'abonnement auprès du backend.
 *
 * Ne lève pas : le temps réel est un bonus. Un échec renvoie `null`, l'appelant
 * reste sur le rafraîchissement à la demande, et l'application fonctionne.
 *
 * Le jeton est passé explicitement plutôt que laissé au middleware d'auth :
 * cet appel doit pouvoir échouer en silence, alors que le middleware
 * transforme un 401 en déconnexion globale. Un jeton Mercure refusé ne doit
 * pas éjecter l'utilisateur de l'application.
 */
export async function fetchMercureSubscription(
  apiToken: string,
): Promise<MercureSubscription | null> {
  try {
    const result = await apiClient.GET('/api/mercure/subscription', {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
    if (result.error || !result.data) return null
    return parseMercureSubscription(result.data)
  } catch {
    // Réseau coupé, réponse illisible : le temps réel s'éteint, rien d'autre.
    return null
  }
}

/** `true` si le jeton abonné est expiré (ou le sera dans `skewSeconds`). */
export function isSubscriptionExpired(
  subscription: MercureSubscription,
  skewSeconds = 30,
): boolean {
  const claims = decodeJwt(subscription.token)
  if (!claims?.exp) return false
  return claims.exp * 1000 <= Date.now() + skewSeconds * 1000
}

/** Millisecondes restantes avant expiration. `null` si le jeton n'expire pas. */
export function millisecondsUntilExpiry(subscription: MercureSubscription): number | null {
  const claims = decodeJwt(subscription.token)
  if (!claims?.exp) return null
  return claims.exp * 1000 - Date.now()
}

/* ── Transmettre le jeton au hub ──────────────────────────────────────────
 *
 * `EventSource` ne permet pas de poser d'en-tête : impossible d'envoyer
 * `Authorization: Bearer …`. Mercure offre deux replis, et ils ne se valent
 * pas.
 *
 *  1. **Cookie `mercureAuthorization`** — la voie recommandée, et celle que le
 *     devops a câblée (CORS déjà en `Access-Control-Allow-Credentials: true`
 *     pour `http://localhost:5173`, vérifié). Le jeton ne transite ni dans une
 *     URL ni dans un journal d'accès. Nécessite `withCredentials: true`.
 *
 *  2. **`?authorization=<jwt>`** — accepté par le hub (testé : 200), mais il
 *     met un jeton porteur dans une URL : journaux du proxy, historique,
 *     en-tête `Referer`. À n'utiliser que quand le cookie est hors de portée.
 *
 * Un cookie posé en JavaScript n'est envoyé qu'aux hôtes du même *site*. Les
 * ports n'entrent pas dans le calcul, donc `localhost:5173` → `localhost:3000`
 * fonctionne — c'est la configuration de développement. Un hub sur un autre
 * domaine, lui, ne le recevra jamais : dans ce cas seul le paramètre d'URL
 * reste possible, et le poser côté backend via `Set-Cookie` serait la vraie
 * solution.
 */

/** Domaine enregistrable approximatif, suffisant pour comparer deux hôtes. */
function siteOf(hostname: string): string {
  const parts = hostname.split('.')
  return parts.length <= 2 ? hostname : parts.slice(-2).join('.')
}

/** Le hub partage-t-il le site de la page ? Sinon, le cookie JS est inutile. */
export function hubAcceptsDocumentCookie(hubUrl: string): boolean {
  try {
    const hub = new URL(hubUrl, window.location.origin)
    return siteOf(hub.hostname) === siteOf(window.location.hostname)
  } catch {
    return false
  }
}

/**
 * Pose le cookie `mercureAuthorization` pour ce site.
 *
 * `SameSite=Lax` suffit : un port différent reste le même site, la requête
 * `EventSource` est donc same-site et le cookie part. `Secure` est ajouté dès
 * que la page est en HTTPS — un cookie `Secure` posé depuis `http://localhost`
 * serait rejeté par certains navigateurs, ce qui casserait le développement.
 *
 * @returns `false` si le cookie ne peut pas servir (hub sur un autre site).
 */
export function installSubscriberCookie(subscription: MercureSubscription): boolean {
  if (!hubAcceptsDocumentCookie(subscription.hubUrl)) return false

  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  const expiry = millisecondsUntilExpiry(subscription)
  // Cookie de session par défaut : il disparaît avec l'onglet, ce qui est le
  // bon comportement pour un jeton porteur.
  const maxAge = expiry !== null && expiry > 0 ? `; Max-Age=${Math.floor(expiry / 1000)}` : ''

  document.cookie = `mercureAuthorization=${subscription.token}; Path=/; SameSite=Lax${secure}${maxAge}`
  return true
}

/** Efface le cookie — à la déconnexion, pour ne pas laisser traîner le jeton. */
export function clearSubscriberCookie(): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `mercureAuthorization=; Path=/; SameSite=Lax${secure}; Max-Age=0`
}
