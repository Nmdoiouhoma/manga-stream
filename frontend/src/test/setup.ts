/**
 * Amorçage commun à tous les tests (`setupFiles` de `vite.config.ts`).
 *
 * Trois choses :
 *  - les matchers DOM de `@testing-library/jest-dom` (`toBeInTheDocument`,
 *    `toHaveAttribute`, …), qui augmentent aussi le type de `expect` ;
 *  - le garde réseau, installé **ici** parce que ce fichier s'exécute avant
 *    l'import des modules applicatifs — et que `openapi-fetch` capture
 *    `globalThis.fetch` dès la création du client (voir `test/http.ts`) ;
 *  - un démontage systématique entre deux tests. Testing Library le fait déjà
 *    quand `globals` est activé ; ici il ne l'est pas, donc c'est à nous, sans
 *    quoi les rendus s'empilent dans le même `document` et `getByRole` trouve
 *    deux fois le même bouton.
 */
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { installFetchGuard, resetFetchHandler } from './http'

installFetchGuard()

afterEach(() => {
  cleanup()
  resetFetchHandler()
})
