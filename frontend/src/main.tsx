import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import { USE_MOCKS } from './config'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
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
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
})
