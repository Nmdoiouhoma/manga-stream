import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { ApiError } from '../api/client'

type LocationState = { from?: string } | null

export function LoginPage() {
  const { login, isAuthenticated, sessionExpired, acknowledgeExpiry } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as LocationState)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // The "session expirée" notice is consumed on unmount so it does not follow
  // the user around after they have read it.
  useEffect(() => () => acknowledgeExpiry(), [acknowledgeExpiry])

  // Already signed in (e.g. hit /login from the menu by mistake): go home
  // rather than showing a form that cannot do anything useful.
  if (isAuthenticated) return <Navigate to={from} replace />

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await login({ email: email.trim(), password })
      navigate(from, { replace: true })
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth">
      <div className="panel panel--auth">
        <h1>Connexion</h1>

        {sessionExpired && (
          <p className="notice notice--warn" role="status">
            Votre session a expiré. Reconnectez-vous pour continuer.
          </p>
        )}

        <form onSubmit={handleSubmit} className="form">
          <label className="field">
            <span className="field__label">Adresse e-mail</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">Mot de passe</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && (
            <p className="form__error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
            {pending ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <p className="auth__switch">
          Pas encore de compte ? <Link to="/register" className="link">Créer un compte</Link>
        </p>
      </div>
    </div>
  )
}

/**
 * A missing `/api/login` is a *deployment* state, not a user error — say so
 * explicitly instead of showing "identifiants invalides" for something the
 * user cannot fix.
 */
function messageFor(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) {
    return "La connexion n'est pas encore disponible : le backend n'expose pas encore POST /api/login."
  }
  if (error instanceof Error) return error.message
  return 'La connexion a échoué.'
}
