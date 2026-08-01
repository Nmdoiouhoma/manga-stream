/**
 * The auth context object and its value type.
 *
 * Kept apart from `AuthContext.tsx` on purpose: a module that exports both a
 * component and a non-component breaks React Fast Refresh (and the
 * `react/only-export-components` lint rule). `AuthContext.tsx` exports the
 * provider, `useAuth.ts` exports the hook, and this file holds the plumbing
 * both need.
 */
import { createContext } from 'react'
import type { Credentials, RegisterInput } from '../api/auth'
import type { SessionUser } from './session'

export type AuthContextValue = {
  user: SessionUser | null
  isAuthenticated: boolean
  /** True between the moment the token died and the moment the user sees /login. */
  sessionExpired: boolean
  login: (credentials: Credentials) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => void
  acknowledgeExpiry: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
