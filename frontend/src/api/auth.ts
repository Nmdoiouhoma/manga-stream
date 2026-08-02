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
 * ⚠️ Not simply `user['@id']`. `GET /api/me` is a custom operation and API
 * Platform answers it with `"@id": "/api/me"` — the *operation* IRI, not the
 * resource one. Verified against the running backend on 2026-08-01.
 *
 * That distinction is not cosmetic: this IRI is what `Favorite.user`,
 * `Progress.user` and `Comment.user` reference, and what the `?user=` filters
 * are matched against. Sending `/api/me` there happens to be tolerated today
 * (the backend overrides `user` server-side and API Platform silently drops an
 * unresolvable filter value), but it is wrong, and it would break the moment
 * either of those behaviours changed.
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
  // else — no 401, no 400. `openapi-fetch` therefore types `result.error` as
  // `never`, and testing it would narrow the whole result away. The status is
  // read straight off the `Response` instead. Still true on the 2026-08-02
  // contract (re-checked): the workaround stays until the backend documents
  // the failure responses.
  const { status } = result.response
  const token = result.data?.token

  if (!token) {
    // A 401 here is a wrong password, not an expired session. The middleware
    // deliberately ignores it (the request carries no Authorization header),
    // so translating it is this function's job.
    if (status === 401) throw new ApiError('Identifiants invalides.', 401)
    if (status >= 200 && status < 300) {
      throw new ApiError('La réponse de connexion ne contient aucun jeton.', status)
    }
    throw new ApiError(`La connexion a échoué (${status}).`, status)
  }

  // Le backend joint l'abonnement Mercure à la réponse de connexion (clé
  // `mercure`), ce qui évite un second aller-retour juste pour ouvrir le flux.
  // Le contrat ne décrit que `{ token }` pour cette opération : la clé est lue
  // en `unknown` puis validée, et son absence est un cas nominal — le backend
  // l'omet volontairement si l'émission du jeton échoue, et le flux se
  // rattrape alors sur `GET /api/mercure/subscription`.
  const mercure = subscriptionFromLogin(result.data as unknown)

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
