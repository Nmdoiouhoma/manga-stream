/// <reference types="vitest/config" />
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Nom du worker généré par `msw init public/` — celui déclaré dans package.json. */
const MOCK_WORKER_FILE = 'mockServiceWorker.js'

/**
 * Retire `mockServiceWorker.js` du bundle de production.
 *
 * Le fichier vit dans `public/` parce que MSW exige de le servir à la racine du
 * scope en développement. Mais `public/` est copié tel quel dans `dist/`, si
 * bien que **la production servait le worker de mock** (vérifié : un GET sur
 * `/mockServiceWorker.js` de l'instance déployée répondait 200
 * `application/javascript`).
 *
 * Deux conséquences, et c'est la seconde qui compte :
 *  1. on publie un fichier qui n'a rien à faire là ;
 *  2. surtout, un Service Worker enregistré du temps où `VITE_USE_MOCKS=true`
 *     **survit** à la désactivation des mocks : le navigateur revalide son
 *     script périodiquement, obtient 200, et le garde donc installé
 *     indéfiniment. Un 404 est justement ce qui pousse le navigateur à le
 *     désinstaller de lui-même.
 *
 * Le nettoyage est fait après écriture (`closeBundle`) plutôt qu'en filtrant la
 * copie de `publicDir` : Vite n'expose pas de crochet sur cette copie, et
 * supprimer un fichier nommément connu de `outDir` se vérifie d'un coup d'œil.
 */
function dropMockServiceWorker(): Plugin {
  let resolved: ResolvedConfig

  return {
    name: 'manga-stream:drop-mock-service-worker',
    apply: 'build',
    configResolved(config) {
      resolved = config
    },
    async closeBundle() {
      // `build.outDir` peut être relatif à `root`, ou déjà absolu.
      const outDir = path.resolve(resolved.root, resolved.build.outDir)
      await rm(path.join(outDir, MOCK_WORKER_FILE), { force: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dropMockServiceWorker()],

  test: {
    environment: 'jsdom',
    // Pas de globals : les tests importent `describe`/`it`/`expect` de vitest,
    // ce qui évite d'ajouter un `types` global à toute la base de code.
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**', 'public/**'],
    restoreMocks: true,
    /**
     * `API_BASE_URL` vaut '' en production (même origine), ce que le `fetch`
     * de Node refuse : `openapi-fetch` construit un `Request`, et une URL
     * relative y lève « Failed to parse URL » avant même qu'un espion puisse
     * intercepter quoi que ce soit. Une base absolue rend les requêtes
     * observables sans rien changer au code testé — `normalizeBaseUrl` reste
     * couvert par ses propres tests, sur ses propres entrées.
     */
    env: { VITE_API_URL: 'http://api.test/api' },
  },
})
