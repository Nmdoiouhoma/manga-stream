import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './AuthContext'

/** Access to the current session. Throws if used outside `<AuthProvider>`. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth doit être utilisé à l’intérieur de <AuthProvider>')
  return context
}
