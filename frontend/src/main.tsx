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

/** Le script généré par `msw init` ; le seul Service Worker que l'app installe. */
const MOCK_WORKER_SCRIPT = 'mockServiceWorker.js'
/** Empêche une boucle de rechargement si le désenregistrement ne « prend » pas. */
const PURGE_GUARD_KEY = 'manga-stream:mock-worker-purged'

function alreadyReloaded(): boolean {
  try {
    return sessionStorage.getItem(PURGE_GUARD_KEY) === '1'
  } catch {
    // Safari en navigation privée refuse l'écriture : mieux vaut renoncer au
    // rechargement automatique que boucler dessus.
    return true
  }
}

function rememberReload() {
  try {
    sessionStorage.setItem(PURGE_GUARD_KEY, '1')
  } catch {
    /* voir alreadyReloaded() */
  }
}

function isMockWorker(worker: ServiceWorker | null | undefined): boolean {
  return worker?.scriptURL.includes(MOCK_WORKER_SCRIPT) === true
}

/** Au-delà, on renonce au nettoyage plutôt que de retarder l'affichage. */
const PURGE_TIMEOUT_MS = 2_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('délai dépassé')), ms)
    }),
  ])
}

/**
 * Désenregistre tout Service Worker MSW resté en place alors que les mocks sont
 * éteints.
 *
 * ── Pourquoi ce nettoyage existe ──────────────────────────────────────────
 * Aux phases 1-2, `VITE_USE_MOCKS=true` enregistrait un Service Worker. Rien ne
 * le désinstalle quand on passe à `false` : un Service Worker survit à la page
 * qui l'a posé, et tant que son script répond 200 le navigateur le conserve.
 * Or `public/mockServiceWorker.js` était copié dans `dist/` et **servi en
 * production** (200, vérifié sur l'instance déployée). Tout navigateur ayant
 * ouvert l'app à ces phases-là gardait donc un worker de mock installé.
 *
 * Le build ne le publie plus (voir le plugin de `vite.config.ts`), mais cela ne
 * suffit pas : les workers déjà installés restent installés. D'où ce
 * désenregistrement explicite au démarrage.
 *
 * ── Le rechargement n'est pas une coquetterie ─────────────────────────────
 * `unregister()` retire l'enregistrement, mais la page **déjà contrôlée** le
 * reste jusqu'à sa prochaine navigation : le worker continuerait d'arbitrer
 * tous les `fetch` de cette session. Un rechargement unique, protégé par un
 * drapeau de session, est le seul moyen de reprendre la main tout de suite.
 *
 * @returns `true` si un rechargement est en cours — l'appelant ne doit alors
 *          rien monter.
 */
async function purgeStaleMockWorker(): Promise<boolean> {
  if (USE_MOCKS) return false
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false

  let registrations: readonly ServiceWorkerRegistration[]
  try {
    // Course contre une horloge : ce nettoyage précède le montage de
    // l'application, donc une promesse qui ne se résout jamais — worker bloqué,
    // navigateur exotique — donnerait un écran blanc. Renoncer au nettoyage est
    // toujours préférable à ne pas afficher le site.
    registrations = await withTimeout(navigator.serviceWorker.getRegistrations(), PURGE_TIMEOUT_MS)
  } catch {
    // Contexte non sécurisé, API désactivée, ou délai dépassé.
    return false
  }

  const stale = registrations.filter(
    (registration) =>
      isMockWorker(registration.active) ||
      isMockWorker(registration.waiting) ||
      isMockWorker(registration.installing),
  )
  if (stale.length === 0) return false

  const controlled = isMockWorker(navigator.serviceWorker.controller)
  await Promise.all(stale.map((registration) => registration.unregister().catch(() => false)))

  console.warn(
    `[msw] ${stale.length} Service Worker de mock résiduel(s) désenregistré(s) : les mocks sont ` +
      'désactivés, mais un worker installé lors d’une visite précédente restait en place.',
  )

  if (!controlled || alreadyReloaded()) return false

  rememberReload()
  window.location.reload()
  return true
}

async function bootstrap() {
  // Monter l'application pendant qu'un rechargement est en vol n'afficherait
  // qu'un écran voué à disparaître, en tirant des requêtes encore arbitrées par
  // le worker qu'on vient de retirer.
  if (await purgeStaleMockWorker()) return

  await enableMocking()

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
}

void bootstrap()
