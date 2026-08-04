/**
 * Interception du réseau pour les tests.
 *
 * ── Pourquoi un garde global plutôt qu'un `vi.spyOn(globalThis, 'fetch')` ──
 * `openapi-fetch` capture `globalThis.fetch` **au moment où le client est
 * créé**, c'est-à-dire à l'évaluation de `src/api/client.ts` :
 *
 *     const { fetch: baseFetch = globalThis.fetch } = clientOptions
 *
 * Un espion posé dans le corps d'un test arrive donc trop tard — le client
 * garde une référence sur la fonction d'origine, et la requête part pour de
 * vrai. Le remplacement doit avoir lieu avant que le graphe de modules de
 * l'application ne soit importé : c'est le rôle de `setupFiles`, exécuté avant
 * le fichier de test.
 *
 * ── Un défaut qui échoue bruyamment ───────────────────────────────────────
 * Sans gestionnaire installé, toute requête lève. Un test qui oublie de
 * simuler un appel casse au lieu de partir silencieusement sur le réseau, d'y
 * prendre une seconde de latence, et de devenir instable le jour où la CI
 * tourne hors ligne.
 */

/** Répond à une requête interceptée. */
export type FetchHandler = (request: Request) => Response | Promise<Response>

let handler: FetchHandler | null = null
let calls: Request[] = []

/**
 * Remplace `globalThis.fetch`. Appelé une seule fois, depuis `setup.ts`, avant
 * tout import applicatif.
 */
export function installFetchGuard(): void {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    // Normalisé en `Request` pour que les tests inspectent méthode, URL, en-têtes
    // et corps de la même façon, quelle que soit la forme d'appel.
    const request = new Request(input, init)
    calls.push(request)

    if (!handler) {
      throw new Error(
        `Requête réseau non simulée dans un test : ${request.method} ${request.url}. ` +
          'Installez un gestionnaire avec setFetchHandler().',
      )
    }
    return handler(request)
  }
}

/** Installe la réponse aux requêtes du test en cours. */
export function setFetchHandler(next: FetchHandler): void {
  handler = next
}

/** Les requêtes vues depuis le début du test, dans l'ordre. */
export function fetchCalls(): readonly Request[] {
  return calls
}

/** Appelé entre deux tests : ni gestionnaire ni historique ne doivent fuiter. */
export function resetFetchHandler(): void {
  handler = null
  calls = []
}
