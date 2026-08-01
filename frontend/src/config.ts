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
 * ── Every topic here MUST be user-scoped ──────────────────────────────────
 * Phase 2 also subscribed to `{origin}/api/notifications/{id}` — API Platform's
 * default per-resource topic, as an RFC 6570 template. That template matches
 * **every** notification of **every** user, and the dev hub runs with the
 * `anonymous` directive (see `docker-compose.yml`), so any browser subscribing
 * to it received other people's notification events. The client-side owner
 * filter in `useNotificationStream` limited the damage but did not prevent the
 * payloads from reaching the tab. It has been **removed**, and nothing that is
 * not scoped by `{userIri}`/`{userId}` may be added back.
 *
 * ── The convention is still the backend's call ────────────────────────────
 * As of 2026-08-02 the backend publishes **nothing**: `symfony/mercure-bundle`
 * is not installed, no resource carries `mercure: true`, and no `HubInterface`
 * is injected anywhere in `backend/src`. There is therefore no convention to
 * adopt yet — verified by subscribing to `?topic=*` on the hub and triggering
 * a notification/favourite/comment creation: the stream stayed empty.
 *
 * The defaults below are the two plausible **user-scoped** shapes (absolute,
 * as Mercure recommends, and relative in case IRIs are published as-is). When
 * the backend fixes its convention, set `VITE_MERCURE_TOPICS` to it — the whole
 * thing is one env var, no code change.
 */
const DEFAULT_MERCURE_TOPICS = [
  '{origin}{userIri}',
  '{origin}{userIri}/notifications',
  '{userIri}',
].join(',')

const MERCURE_TOPIC_TEMPLATES = (
  import.meta.env.VITE_MERCURE_TOPICS?.trim() || DEFAULT_MERCURE_TOPICS
)
  .split(',')
  .map((topic) => topic.trim())
  .filter(Boolean)

/**
 * Expands the topic templates for one user. Returns `[]` when anonymous.
 *
 * **Enforced invariant**: a topic that does not mention the user is dropped,
 * whatever `VITE_MERCURE_TOPICS` says. A template without `{userIri}` /
 * `{userId}` — or one containing an RFC 6570 wildcard like `{id}` or `*` —
 * would subscribe this browser to other accounts' events on a hub that accepts
 * anonymous subscribers. The check is here rather than at parse time so a
 * misconfiguration is caught in the deployed app, not only in review.
 */
export function mercureTopicsFor(userIri: string | null, userId: number | null): string[] {
  if (!userIri) return []
  // `API_BASE_URL` is '' when the API is same-origin.
  const origin = API_BASE_URL || window.location.origin
  const scope = userId !== null ? String(userId) : ''

  const expanded = MERCURE_TOPIC_TEMPLATES.map((template) =>
    template
      .replaceAll('{origin}', origin)
      .replaceAll('{userIri}', userIri)
      .replaceAll('{userId}', scope),
  ).filter(Boolean)

  const scoped = expanded.filter((topic) => {
    // Any placeholder left over is a wildcard as far as the hub is concerned.
    if (topic.includes('*') || /\{[^}]*}/.test(topic)) return false
    return topic.includes(userIri) || (scope !== '' && topic.includes(scope))
  })

  if (scoped.length !== expanded.length) {
    console.warn(
      '[mercure] Topic(s) non cloisonné(s) par utilisateur ignoré(s) — ils exposeraient les ' +
        'événements des autres comptes sur un hub ouvert aux abonnés anonymes :',
      expanded.filter((topic) => !scoped.includes(topic)),
    )
  }

  return [...new Set(scoped)]
}
