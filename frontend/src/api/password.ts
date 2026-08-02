/**
 * Réinitialisation de mot de passe.
 *
 * ── Pourquoi ce module n'utilise pas le client typé ───────────────────────
 * `POST /api/password/forgot` et `POST /api/password/reset` **ne sont pas dans
 * `docs/openapi.yaml`** au 2026-08-02 (vérifié dans le contrat, et confirmé
 * contre le backend qui tourne : les deux répondent 404). `apiClient` ne peut
 * donc pas les appeler — `paths` ne les connaît pas, et forcer le typage
 * demanderait un `as never` qui masquerait précisément l'information utile :
 * ces routes n'existent pas encore.
 *
 * Les appels passent donc par `fetch`, avec des types écrits à la main d'après
 * la spécification annoncée :
 *
 *     POST /api/password/forgot  { email }                → 204
 *     POST /api/password/reset   { token, plainPassword } → 204
 *
 * **À faire dès que le contrat les décrit** : `npm run generate:api`, puis
 * remplacer les deux `fetch` par `apiClient.POST(...)` et supprimer les types
 * locaux. Rien d'autre ne bouge : les pages ne connaissent que les fonctions
 * exportées ici.
 *
 * ── Non-énumération des comptes ───────────────────────────────────────────
 * `forgot` répond 204 que l'adresse existe ou non — c'est délibéré côté
 * backend, pour empêcher de tester l'existence d'un compte. Cette fonction ne
 * doit donc **jamais** distinguer les deux cas, ni par sa valeur de retour ni
 * par une erreur. Elle ne renvoie rien.
 */
import { API_BASE_URL } from '../config'
import { ApiError, RateLimitError } from './client'
import { parseRetryAfter, rateLimitMessage } from '../lib/retryAfter'

type ProblemBody = {
  detail?: unknown
  violations?: unknown
}

/** Lit un corps d'erreur sans jamais laisser une exception de parsing remonter. */
async function readProblem(response: Response): Promise<ProblemBody> {
  try {
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null ? (body as ProblemBody) : {}
  } catch {
    // Corps vide ou non-JSON (page d'erreur du proxy, 502 nginx…).
    return {}
  }
}

/**
 * Transforme une réponse non-2xx en erreur présentable.
 *
 * Les messages sont écrits ici plutôt que repris du serveur quand le serveur
 * n'en donne pas d'exploitable : « Failed to fetch » ou une trace n'ont rien à
 * faire devant l'utilisateur.
 */
async function toError(response: Response, fallback: string): Promise<ApiError> {
  if (response.status === 429) {
    const seconds = parseRetryAfter(response.headers.get('Retry-After'))
    return new RateLimitError(rateLimitMessage(seconds), seconds)
  }

  const problem = await readProblem(response)
  const violations = Array.isArray(problem.violations) ? problem.violations : []
  const messages = violations
    .map((violation) =>
      typeof violation === 'object' && violation !== null && 'message' in violation
        ? String((violation as { message: unknown }).message)
        : '',
    )
    .filter((message) => message.trim() !== '')

  if (messages.length > 0) return new ApiError(messages.join(' '), response.status)

  const detail = typeof problem.detail === 'string' ? problem.detail.trim() : ''
  // Un `detail` long est une trace, pas une phrase : on ne l'affiche pas.
  const usable = detail !== '' && detail.length <= 200 ? detail : null
  return new ApiError(usable ?? fallback, response.status)
}

async function post(path: string, body: unknown, fallback: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // Panne réseau : `fetch` rejette au lieu de renvoyer une réponse.
    throw new ApiError('Le serveur est injoignable. Vérifiez votre connexion.')
  }

  if (!response.ok) throw await toError(response, fallback)
}

/**
 * Demande un email de réinitialisation.
 *
 * Ne dit **pas** si l'adresse existe : le backend répond 204 dans les deux cas
 * et cette fonction n'a aucun moyen — ni aucune envie — de faire la différence.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await post('/api/password/forgot', { email }, 'La demande a échoué.')
}

/** Consomme un jeton de réinitialisation et pose le nouveau mot de passe. */
export async function resetPassword(token: string, plainPassword: string): Promise<void> {
  await post(
    '/api/password/reset',
    { token, plainPassword },
    'La réinitialisation a échoué. Le lien est peut-être expiré.',
  )
}
