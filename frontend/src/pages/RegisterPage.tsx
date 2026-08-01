import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

const MIN_PASSWORD_LENGTH = 8

export function RegisterPage() {
  const { register, isAuthenticated } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (isAuthenticated) return <Navigate to="/" replace />

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)

    // Client-side checks are courtesy only; the backend validates for real.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`)
      return
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.')
      return
    }

    setPending(true)
    try {
      const { loggedIn } = await register({
        email: email.trim(),
        username: username.trim(),
        password,
      })

      if (loggedIn) {
        navigate('/', { replace: true })
      } else {
        // Account created, but `POST /api/login` does not exist yet on the
        // backend. Telling the user their account exists is far better than
        // failing an operation that actually succeeded.
        setNotice(
          'Compte créé. La connexion automatique est impossible pour le moment ' +
            "(le backend n'expose pas encore POST /api/login) — réessayez de vous connecter plus tard.",
        )
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'La création du compte a échoué.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth">
      <div className="panel panel--auth">
        <h1>Créer un compte</h1>

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
            <span className="field__label">Nom d’utilisateur</span>
            <input
              className="input"
              type="text"
              autoComplete="username"
              required
              minLength={3}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">Mot de passe</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">Confirmation</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>

          {error && (
            <p className="form__error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="notice notice--warn" role="status">
              {notice}
            </p>
          )}

          <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
            {pending ? 'Création…' : 'Créer mon compte'}
          </button>
        </form>

        <p className="auth__switch">
          Déjà inscrit ? <Link to="/login" className="link">Se connecter</Link>
        </p>
      </div>
    </div>
  )
}
