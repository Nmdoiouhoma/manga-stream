/**
 * React mirror of the plain session store (`auth/session.ts`).
 *
 * The store stays the source of truth so the API client can read the token
 * without importing React. This provider only subscribes to it and re-renders.
 */
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  getSession,
  onUnauthorized,
  setSession,
  subscribe,
  type Session,
  type SessionUser,
} from './session'
import { login as loginRequest, register as registerRequest } from '../api/auth'
import type { Credentials, RegisterInput } from '../api/auth'

export type AuthContextValue = {
  user: SessionUser | null
  isAuthenticated: boolean
  /** True between the moment the token died and the moment the user sees /login. */
  sessionExpired: boolean
  login: (credentials: Credentials) => Promise<void>
  register: (input: RegisterInput) => Promise<{ loggedIn: boolean }>
  logout: () => void
  acknowledgeExpiry: () => void
}

/**
 * Exported so `useAuth` (a separate module, to keep this file component-only
 * for fast refresh) can read it. Nothing else should consume it directly.
 */
export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setLocalSession] = useState<Session | null>(() => getSession())
  const [sessionExpired, setSessionExpired] = useState(false)
  const queryClient = useQueryClient()

  // Keep React in sync with the store, whoever mutated it (login form, API
  // middleware on 401, another tab…).
  useEffect(() => subscribe(setLocalSession), [])

  useEffect(
    () =>
      onUnauthorized(() => {
        setSessionExpired(true)
        // Every cached list is user-scoped (favorites, progress, comments,
        // notifications). Dropping the cache prevents the next user — or the
        // anonymous view — from briefly seeing the previous one's data.
        queryClient.clear()
      }),
    [queryClient],
  )

  const login = useCallback(
    async (credentials: Credentials) => {
      const next = await loginRequest(credentials)
      setSessionExpired(false)
      setSession(next)
      // The anonymous cache holds "not a favourite / no progress" answers.
      await queryClient.invalidateQueries()
    },
    [queryClient],
  )

  const register = useCallback(
    async (input: RegisterInput) => {
      const next = await registerRequest(input)
      if (!next) return { loggedIn: false }
      setSessionExpired(false)
      setSession(next)
      await queryClient.invalidateQueries()
      return { loggedIn: true }
    },
    [queryClient],
  )

  const logout = useCallback(() => {
    setSession(null)
    setSessionExpired(false)
    queryClient.clear()
  }, [queryClient])

  const acknowledgeExpiry = useCallback(() => setSessionExpired(false), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      isAuthenticated: session !== null,
      sessionExpired,
      login,
      register,
      logout,
      acknowledgeExpiry,
    }),
    [session, sessionExpired, login, register, logout, acknowledgeExpiry],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
