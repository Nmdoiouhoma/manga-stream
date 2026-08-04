/**
 * Amorçage commun à tous les tests (`setupFiles` de `vite.config.ts`).
 *
 * Deux choses seulement :
 *  - les matchers DOM de `@testing-library/jest-dom` (`toBeInTheDocument`,
 *    `toHaveAttribute`, …), qui augmentent aussi le type de `expect` ;
 *  - un démontage systématique entre deux tests. Testing Library le fait déjà
 *    quand `globals` est activé ; ici il ne l'est pas, donc c'est à nous, sans
 *    quoi les rendus s'empilent dans le même `document` et `getByRole` trouve
 *    deux fois le même bouton.
 */
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

afterEach(() => {
  cleanup()
})
