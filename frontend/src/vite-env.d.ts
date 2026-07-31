/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API Platform backend. Empty = same origin. */
  readonly VITE_API_URL?: string
  /** "false" disables MSW in dev. Anything else (or unset) enables it. */
  readonly VITE_USE_MOCKS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
