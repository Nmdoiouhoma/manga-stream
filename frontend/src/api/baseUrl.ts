/**
 * Base-URL normalisation.
 *
 * Kept in its own env-free module so it can be unit-tested outside Vite.
 *
 * Why this exists: the OpenAPI contract declares `servers: [{ url: "/" }]` and
 * every path in it already starts with `/api` (`/api/animes`, `/api/genres`, …).
 * But the shared `docker-compose.yml` / `.env.example` set
 *
 *     VITE_API_URL=http://localhost:8000/api
 *
 * i.e. the `/api` prefix is included there too. Concatenating naively would
 * request `http://localhost:8000/api/api/animes`.
 *
 * Rather than fight over whose convention wins, we accept both: a trailing
 * `/api` (and any trailing slash) is stripped from the configured base URL,
 * because the generated paths always supply it.
 */

/**
 * @param raw the configured base URL, e.g. "http://localhost:8000/api" or ""
 * @returns an origin-ish prefix with no trailing slash and no trailing `/api`
 */
export function normalizeBaseUrl(raw: string | undefined | null): string {
  if (!raw) return ''

  let base = raw.trim()
  if (!base) return ''

  // Drop trailing slashes.
  base = base.replace(/\/+$/, '')

  // Drop a trailing `/api` segment — the contract paths already carry it.
  base = base.replace(/\/api$/i, '')

  // Re-drop slashes in case the value was just "/api/" or "http://host/api/".
  return base.replace(/\/+$/, '')
}
