/**
 * Runtime configuration, read from Vite env vars (see `.env.example`).
 */
import { normalizeBaseUrl } from './api/baseUrl'

/**
 * Base URL of the API Platform backend.
 *
 * The contract declares `servers: [{ url: "/" }]`, so the base URL is the
 * frontend's responsibility. Empty string = same origin, which is what MSW
 * intercepts in dev.
 *
 * Normalised on purpose: the shared docker-compose sets
 * `VITE_API_URL=http://localhost:8000/api`, and the generated paths already
 * begin with `/api`. See `normalizeBaseUrl` for the full rationale.
 */
export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL)

/**
 * Whether MSW should intercept API calls.
 *
 * Defaults to `true` so the front can be developed without the backend running.
 * Mocks are *never* enabled in a production build, whatever the env var says.
 */
export const USE_MOCKS =
  import.meta.env.DEV && (import.meta.env.VITE_USE_MOCKS ?? 'true') !== 'false'

/**
 * Page size requested from the API.
 * The contract documents a default of 30 and a hard maximum of 100.
 */
export const ITEMS_PER_PAGE = 30

/**
 * Mercure hub URL for real-time notifications, e.g.
 * `http://localhost:3000/.well-known/mercure` (the docker-compose default).
 *
 * Empty/unset disables the SSE subscription entirely — the notification bell
 * then works on refresh only, which is a supported mode, not a failure.
 */
export const MERCURE_URL = (import.meta.env.VITE_MERCURE_URL ?? '').trim()

/**
 * Topics the app subscribes to, comma-separated. Two placeholders are
 * substituted at runtime: `{userIri}` (e.g. `/api/users/1`) and `{userId}`.
 *
 * ⚠️ The backend has **not** frozen its publishing convention yet, so the
 * default below is a spread bet over the plausible ones:
 *   - `{origin}{userIri}`   → per-user channel, absolute IRI (Mercure's norm)
 *   - `{userIri}`           → same, relative, in case IRIs are published as-is
 *   - `{origin}/api/notifications/{id}` → API Platform's default per-resource
 *     topic, as an RFC 6570 template
 *
 * The last one is a catch-all and is **not user-scoped**: with the hub open to
 * anonymous subscribers it means we can receive other users' notification
 * events. Messages are filtered by user before being used (see
 * `useNotificationStream`), and this should be narrowed down as soon as the
 * backend states its convention. Override with `VITE_MERCURE_TOPICS`.
 */
const DEFAULT_MERCURE_TOPICS = [
  '{origin}{userIri}',
  '{userIri}',
  '{origin}/api/notifications/{id}',
].join(',')

const MERCURE_TOPIC_TEMPLATES = (
  import.meta.env.VITE_MERCURE_TOPICS?.trim() || DEFAULT_MERCURE_TOPICS
)
  .split(',')
  .map((topic) => topic.trim())
  .filter(Boolean)

/** Expands the topic templates for one user. Returns `[]` when anonymous. */
export function mercureTopicsFor(userIri: string | null, userId: number | null): string[] {
  if (!userIri) return []
  // `API_BASE_URL` is '' when the API is same-origin.
  const origin = API_BASE_URL || window.location.origin

  return [
    ...new Set(
      MERCURE_TOPIC_TEMPLATES.map((template) =>
        template
          .replaceAll('{origin}', origin)
          .replaceAll('{userIri}', userIri)
          .replaceAll('{userId}', userId !== null ? String(userId) : ''),
      ).filter(Boolean),
    ),
  ]
}
