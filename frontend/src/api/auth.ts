/**
 * Login / registration / current user.
 *
 * Everything here is contract-typed since the 2026-08-01 regeneration, which
 * added `securitySchemes.JWT` plus the three operations the frontend had been
 * waiting for:
 *   - `POST /api/login`    → `{ email, password }` ⇒ `{ token }`
 *   - `POST /api/register` → `User-user.write` ⇒ the created `User`
 *   - `GET  /api/me`       → the authenticated user, no id needed
 *
 * `/api/me` is what makes the session honest: the app needs the user's **IRI**
 * (every write references it) and previously had to guess it from a
 * `GET /api/users?email=` lookup. `POST /api/users` still exists but the
 * contract now marks it `@deprecated`, so registration goes through
 * `/api/register`.
 */
import { apiClient, ApiError, jsonApiClient, unwrap } from './client'
import { subscriptionFromLogin } from './mercure'
import type { Session, SessionUser } from '../auth/session'
import type { components } from './schema'

export type Credentials = { email: string; password: string }
export type RegisterInput = { email: string; username: string; password: string }

type User =
  | components['schemas']['User.jsonld-user.read']
  | components['schemas']['User.jsonld-user.read_user.item.read']

/**
 * The user's **resource** IRI, `/api/users/{id}`.
 *
 * ── Historique ────────────────────────────────────────────────────────────
 * `GET /api/me` répondait `"@id": "/api/me"` — l'IRI de l'*opération*, pas
 * celle de la ressource. Or c'est cette valeur que le front renvoie dans
 * `Favorite.user`, `Progress.user`, `Comment.user`, et que les filtres
 * `?user=` comparent. Écart remonté au backend, **corrigé** le 2026-08-02
 * (`item_uri_template`) : `GET /api/me` renvoie désormais
 * `"@id": "/api/users/16"` — revérifié contre le backend qui tourne.
 *
 * ── Pourquoi la fonction reste ────────────────────────────────────────────
 * Elle est devenue un no-op : la première branche accepte l'IRI telle quelle.
 * Elle est conservée comme garde-fou, pour trois raisons.
 *  1. `docs/openapi.yaml` n'a pas encore été régénéré ; rien dans le contrat
 *     ne fige encore la correction.
 *  2. Le mode de panne est silencieux et coûteux : une IRI d'opération
 *     envoyée en `Favorite.user` est aujourd'hui tolérée (le backend impose
 *     le propriétaire depuis le jeton, et API Platform ignore une valeur de
 *     filtre non résolvable) — donc une régression ne se verrait pas tout de
 *     suite, elle se verrait quand ces deux comportements changeraient.
 *  3. Elle coûte deux lignes et aucune requête.
 * À supprimer une fois le contrat régénéré et la correction couverte par un
 * test côté backend.
 */
function canonicalUserIri(user: User): string {
  const iri = user['@id']
  if (/\/users\/[^/]+$/.test(iri)) return iri
  return user.id != null ? `/api/users/${user.id}` : iri
}

function toSessionUser(user: User): SessionUser {
  return {
    iri: canonicalUserIri(user),
    id: user.id ?? null,
    username: user.username,
    email: user.email,
    roles: user.roles ?? ['ROLE_USER'],
  }
}

/**
 * The authenticated user behind a token.
 *
 * The token is passed explicitly instead of relying on the auth middleware:
 * at login time it is not in the session store yet, and writing it there first
 * would flash a half-built session (token, no user) through every subscriber.
 */
export async function fetchMe(token: string): Promise<SessionUser> {
  const result = await apiClient.GET('/api/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return toSessionUser(unwrap(result))
}

export async function login({ email, password }: Credentials): Promise<Session> {
  // `jsonApiClient`, not `apiClient`: the login operation declares
  // `application/json` only — there is no JSON-LD variant to negotiate.
  const result = await jsonApiClient.POST('/api/login', {
    body: { email, password },
  })

  // ⚠️ The contract declares a `200` response for this operation and nothing
  // else — no 401, no 400 — so `openapi-fetch` typed `result.error` as `never`
  // and the front had to read the status off the raw `Response`. Écart remonté
  // et **corrigé** le 2026-08-02 : l'opération documente maintenant le 401
  // (corps lexik `{code, message}`) et le 400 (RFC 7807). `result.error` est
  // enfin exploitable, et le contournement est retiré.
  const { status } = result.response

  if (result.error) {
    // Un 401 ici est un mot de passe faux, pas une session expirée. Le
    // middleware l'ignore délibérément (la requête ne porte aucun en-tête
    // `Authorization`) : traduire l'erreur revient donc à cette fonction.
    if (status === 401) throw new ApiError('Identifiants invalides.', 401)
    // Le 400 est du RFC 7807 et porte un `detail` exploitable ; le 401 est au
    // format lexik et n'en a pas. Les deux formes sont lues sans supposer
    // laquelle est arrivée.
    const detail =
      'detail' in result.error && typeof result.error.detail === 'string'
        ? result.error.detail
        : null
    throw new ApiError(detail ?? `La connexion a échoué (${status}).`, status)
  }

  const token = result.data?.token
  if (!token) {
    throw new ApiError('La réponse de connexion ne contient aucun jeton.', status)
  }

  // Le backend joint l'abonnement Mercure à la réponse de connexion, ce qui
  // évite un second aller-retour juste pour ouvrir le flux. Le contrat décrit
  // désormais la clé et la marque **optionnelle** — le listener l'omet quand
  // l'émission du jeton échoue, et le flux se rattrape alors tout seul sur
  // `GET /api/mercure/subscription`.
  const mercure = subscriptionFromLogin(result.data)

  return { token, user: await fetchMe(token), mercure }
}

/**
 * Creates the account, then logs in with the same credentials.
 *
 * `/api/register` returns the created `User` but no token — the contract has
 * no combined operation — so the second round-trip is unavoidable.
 */
export async function register(input: RegisterInput): Promise<Session> {
  const result = await apiClient.POST('/api/register', {
    body: {
      email: input.email,
      username: input.username,
      plainPassword: input.password,
    },
  })
  unwrap(result)

  return login({ email: input.email, password: input.password })
}
