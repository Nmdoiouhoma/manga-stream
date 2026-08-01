/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API Platform backend. Empty = same origin. */
  readonly VITE_API_URL?: string
  /** "false" disables MSW in dev. Anything else (or unset) enables it. */
  readonly VITE_USE_MOCKS?: string
  /** Mercure hub URL, e.g. http://localhost:3000/.well-known/mercure. Empty = no SSE. */
  readonly VITE_MERCURE_URL?: string
  /** Comma-separated Mercure topics; supports {origin}, {userIri}, {userId}. */
  readonly VITE_MERCURE_TOPICS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
