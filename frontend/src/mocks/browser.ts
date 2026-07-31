import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

/**
 * Starts the mock service worker. Called from `main.tsx` only when
 * `VITE_USE_MOCKS` is enabled (see `src/config.ts`), and tree-shaken out of
 * production builds because the import is dynamic and guarded by `import.meta.env.DEV`.
 */
export async function startMockWorker() {
  await worker.start({
    // The app also loads real assets (placeholder covers); don't spam the console
    // about requests we deliberately do not mock.
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  })
}
