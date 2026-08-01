import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext'
import { ApiError } from './api/client'
import { USE_MOCKS } from './config'
import './index.css'

/**
 * Retrying a 4xx is pointless and, for a 401, actively harmful: it would fire
 * a second doomed request and a second logout signal. Only network-ish and 5xx
 * failures get one retry.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500) {
    return false
  }
  return failureCount < 1
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: shouldRetry,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // A failed write is surfaced to the user; retrying it silently could
      // duplicate a comment or a favourite.
      retry: false,
    },
  },
})

/**
 * Starts MSW before rendering, so the very first queries are already intercepted.
 *
 * The `import.meta.env.DEV` test is written inline (rather than only through
 * `USE_MOCKS`) so Vite can statically replace it with `false` in a production
 * build and drop the dynamic import: `msw` never reaches the shipped bundle.
 */
async function enableMocking() {
  if (!import.meta.env.DEV) return
  if (!USE_MOCKS) return
  const { startMockWorker } = await import('./mocks/browser')
  await startMockWorker()
}

void enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {/* Router outside AuthProvider: the provider itself does not navigate,
            but every guard and page below it does. */}
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
})
