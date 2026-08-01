/**
 * Session store — framework-free on purpose.
 *
 * `src/api/client.ts` needs to read the token (to inject `Authorization`) and
 * to signal a 401 back to the UI. If that lived in a React context, the API
 * client would import React and we would get a nasty import cycle
 * (client → context → queries → client). So the source of truth is this plain
 * module, and `AuthProvider` is just a React mirror of it.
 *
 * ── Storage: why `localStorage`, and what it costs ────────────────────────
 * The JWT is persisted in `localStorage` so a refresh does not log the user
 * out. This is a deliberate MVP trade-off, NOT a recommendation: any XSS on
 * this origin can read `localStorage` and exfiltrate the token. The
 * XSS-resistant alternative is an httpOnly + SameSite cookie issued by the
 * backend, which requires backend work we do not have. See `frontend/README.md`
 * ("Stockage du JWT") for the full write-up.
 */

const STORAGE_KEY = 'manga-stream.session'

/** The authenticated user, as far as the frontend needs to know. */
export type SessionUser = {
  /** Resource IRI, e.g. "/api/users/1" — what every write payload references. */
  iri: string
  id: number | null
  username: string
  email: string
  roles: string[]
}

export type Session = {
  token: string
  user: SessionUser
}

type Listener = (session: Session | null) => void

let current: Session | null = readFromStorage()
const listeners = new Set<Listener>()
/** Fired when the API answered 401 on an authenticated request. */
const unauthorizedListeners = new Set<() => void>()

function readFromStorage(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isSession(parsed)) return null
    // A token already past its `exp` is worthless: drop it now rather than
    // letting the first request 401 and bounce the user to /login.
    if (isTokenExpired(parsed.token)) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    // Corrupted entry, quota error, or storage disabled (private mode).
    return null
  }
}

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Session>
  return (
    typeof candidate.token === 'string' &&
    candidate.token.length > 0 &&
    typeof candidate.user === 'object' &&
    candidate.user !== null &&
    typeof candidate.user.iri === 'string'
  )
}

/** Reads the current session synchronously. Used by the API middleware. */
export function getSession(): Session | null {
  return current
}

export function getToken(): string | null {
  return current?.token ?? null
}

/** Replaces the session and notifies every subscriber. `null` logs out. */
export function setSession(session: Session | null): void {
  current = session
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable — the session still works for this tab, in memory.
  }
  for (const listener of listeners) listener(current)
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

/**
 * Called by the API client when an authenticated request came back 401.
 *
 * ⚠️ Loop guard: the session is cleared *before* notifying, and this function
 * no-ops when there is no session. So the N parallel requests that all 401 at
 * once produce exactly one logout + one redirect, and the requests fired after
 * that carry no token — they cannot 401-because-expired again.
 */
export function notifyUnauthorized(): void {
  if (!current) return
  setSession(null)
  for (const listener of unauthorizedListeners) listener()
}

/* ── JWT introspection ──────────────────────────────────────────────────── */

/**
 * Claims we care about in a LexikJWTAuthenticationBundle token.
 * `username` is what Lexik puts the user identifier in by default; `sub` and
 * `email` are tolerated because the backend may configure it differently.
 */
export type JwtClaims = {
  exp?: number
  iat?: number
  username?: string
  sub?: string
  email?: string
  roles?: string[]
  /** Some setups embed the user id or IRI directly. */
  id?: number
  iri?: string
}

/**
 * Decodes a JWT payload **without verifying the signature**.
 *
 * That is fine here and only here: the token is not trusted on the client, it
 * is merely read for display (`username`) and for the local expiry check. Every
 * authorisation decision is the backend's, which does verify the signature.
 */
export function decodeJwt(token: string): JwtClaims | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    // base64url → base64, then pad.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    )
    const claims: unknown = JSON.parse(json)
    if (typeof claims !== 'object' || claims === null) return null
    return claims as JwtClaims
  } catch {
    return null
  }
}

/**
 * @returns `true` only when the token carries an `exp` that is already past.
 * A token without `exp` is treated as valid — refusing it would lock out any
 * backend that issues non-expiring tokens.
 */
export function isTokenExpired(token: string, skewSeconds = 10): boolean {
  const claims = decodeJwt(token)
  if (!claims?.exp) return false
  return claims.exp * 1000 <= Date.now() + skewSeconds * 1000
}
