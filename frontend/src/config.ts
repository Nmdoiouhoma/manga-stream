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
