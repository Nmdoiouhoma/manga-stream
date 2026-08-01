/**
 * Login / registration calls.
 *
 * ⚠️ Contract status (checked against the running backend on 2026-08-01):
 *   - `POST /api/users` with `{ email, username, plainPassword }` **works
 *     today** and is declared in `docs/openapi.yaml` (`User-user.write`).
 *     Registration therefore goes through the typed client.
 *   - `POST /api/login` is **announced but not shipped** (the live backend
 *     answers 404, and `securitySchemes` is still `{}` in the contract). It is
 *     called here with a hand-written `fetch` + hand-written types. When the
 *     backend publishes it, regenerate the schema and this file can move to the
 *     typed client without touching any caller.
 *
 * Why login bypasses `apiClient`: the auth middleware turns a 401 into a global
 * logout. A wrong password is a 401 too — routing it through the middleware
 * would fire a spurious "session expired" redirect. Login must stay outside.
 */
import { apiClient, ApiError, unwrap } from './client'
import { API_BASE_URL } from '../config'
import { normalizeCollection } from './hydra'
import { decodeJwt, type Session, type SessionUser } from '../auth/session'
import type { components } from './schema'

/** Path of the (not yet contracted) login endpoint. */
const LOGIN_PATH = '/api/login'

export type Credentials = { email: string; password: string }
export type RegisterInput = { email: string; username: string; password: string }

type User = components['schemas']['User.jsonld-user.read']

/** Shapes a token response may take. Lexik returns `token`; OAuth-ish setups `access_token`. */
type LoginResponse = {
  token?: string
  access_token?: string
  /** Some backends embed the user; if they do, we skip the lookup round-trip. */
  user?: { '@id'?: string; id?: number; username?: string; email?: string; roles?: string[] }
  message?: string
}

function toSessionUser(user: User): SessionUser {
  return {
    iri: user['@id'],
    id: user.id ?? null,
    username: user.username,
    email: user.email,
    roles: user.roles ?? ['ROLE_USER'],
  }
}

/**
 * Resolves the authenticated user's resource, which the app needs for its IRI:
 * every write payload (`Favorite.user`, `Progress.user`, `Comment.user`)
 * references it.
 *
 * Strategy, most reliable first:
 *   1. the user embedded in the login response, when there is one;
 *   2. `GET /api/users?email=…` — an exact SearchFilter the contract declares;
 *   3. the JWT claims alone, as a degraded fallback.
 *
 * Step 3 exists because the backend is going to restrict `/api/users`; if that
 * lookup starts returning 403 the app must still log the user in rather than
 * hard-fail. Writes would break in that case, which is exactly the kind of
 * thing worth reporting rather than papering over — hence the console warning.
 */
async function resolveUser(token: string, email: string, embedded?: LoginResponse['user']) {
  if (embedded?.['@id']) {
    return {
      iri: embedded['@id'],
      id: embedded.id ?? null,
      username: embedded.username ?? email,
      email: embedded.email ?? email,
      roles: embedded.roles ?? ['ROLE_USER'],
    } satisfies SessionUser
  }

  try {
    const result = await apiClient.GET('/api/users', {
      params: { query: { email, itemsPerPage: 1 } },
      headers: { Authorization: `Bearer ${token}` },
    })
    const match = normalizeCollection(unwrap(result)).member[0]
    if (match) return toSessionUser(match)
  } catch {
    // Fall through to the claims-only fallback below.
  }

  const claims = decodeJwt(token)
  const iri = claims?.iri ?? (claims?.id != null ? `/api/users/${claims.id}` : null)
  if (!iri) {
    throw new ApiError(
      "Connexion réussie mais l'utilisateur n'a pas pu être identifié (aucun /api/users accessible et aucun identifiant dans le jeton).",
    )
  }
  console.warn(
    '[auth] Utilisateur reconstruit depuis les claims du JWT : /api/users n’a pas répondu.',
  )
  return {
    iri,
    id: claims?.id ?? null,
    username: claims?.username ?? claims?.sub ?? email,
    email,
    roles: claims?.roles ?? ['ROLE_USER'],
  } satisfies SessionUser
}

/** Reads the RFC 7807 / Lexik error body without assuming which one it is. */
async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null) {
      const record = body as Record<string, unknown>
      for (const key of ['detail', 'message', 'error_description', 'title'] as const) {
        const value = record[key]
        if (typeof value === 'string' && value) return value
      }
    }
  } catch {
    // Not JSON (HTML error page, empty body…).
  }
  return fallback
}

export async function login({ email, password }: Credentials): Promise<Session> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${LOGIN_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch {
    throw new ApiError('Serveur injoignable. Vérifiez que le backend est démarré.')
  }

  if (response.status === 404) {
    throw new ApiError(
      "L'endpoint de connexion n'est pas encore disponible sur le backend (POST /api/login → 404).",
      404,
    )
  }
  if (response.status === 401) {
    throw new ApiError('Identifiants invalides.', 401)
  }
  if (!response.ok) {
    throw new ApiError(await readError(response, 'La connexion a échoué.'), response.status)
  }

  const payload = (await response.json()) as LoginResponse
  const token = payload.token ?? payload.access_token
  if (!token) {
    throw new ApiError("La réponse de connexion ne contient aucun jeton (`token` attendu).")
  }

  return { token, user: await resolveUser(token, email, payload.user) }
}

/**
 * Creates the account, then logs in with the same credentials.
 *
 * The account creation is contract-typed. The follow-up login is best-effort:
 * as long as `POST /api/login` is missing, registration succeeds and the user
 * is told to come back once login exists, instead of seeing a hard failure on
 * an operation that actually worked.
 */
export async function register(input: RegisterInput): Promise<Session | null> {
  const result = await apiClient.POST('/api/users', {
    body: {
      email: input.email,
      username: input.username,
      plainPassword: input.password,
    },
  })
  unwrap(result)

  try {
    return await login({ email: input.email, password: input.password })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}
