import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

/**
 * Route guard for `/profile` and `/favorites`.
 *
 * The redirect carries the attempted URL in `state.from` so `/login` can send
 * the user back where they were. `replace` keeps the protected URL out of the
 * history stack — otherwise "back" from /login would bounce straight into the
 * guard again.
 *
 * No loop is possible: `/login` is not itself guarded, and the guard only ever
 * navigates when `isAuthenticated` is false, which the login page flips.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  return <>{children}</>
}
