import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { resetPassword } from '../api/password'

const MIN_PASSWORD_LENGTH = 8

/**
 * `/password/reset?token=…` — choix du nouveau mot de passe.
 *
 * Le jeton est lu dans la query string, pas dans un état de navigation :
 * l'utilisateur arrive ici en cliquant un lien dans un email, donc par un
 * chargement complet, éventuellement dans un autre navigateur.
 *
 * Absence de jeton → on le dit tout de suite plutôt que d'afficher un
 * formulaire dont la soumission échouera de toute façon. La validité du jeton,
 * elle, ne peut être vérifiée qu'à la soumission : le backend est seul à savoir
 * s'il est connu, consommé ou expiré, et on ne va pas la sonder d'avance (ce
 * serait un oracle de plus).
 */
export function PasswordResetPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token')?.trim() ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  if (token === '') {
    return (
      <div className="auth">
        <div className="panel panel--auth">
          <h1>Lien incomplet</h1>
          <p className="muted">
            Ce lien de réinitialisation ne contient pas de jeton. Il a probablement été tronqué par
            votre messagerie — recopiez l’adresse complète, ou demandez-en un nouveau.
          </p>
          <Link to="/password/forgot" className="btn btn--primary btn--block">
            Demander un nouveau lien
          </Link>
        </div>
      </div>
    )
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    // Contrôles de courtoisie : le backend valide pour de vrai.
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
      await resetPassword(token, password)
      setDone(true)
      // Redirection différée : disparaître instantanément ne laisserait pas le
      // temps de lire que l'opération a réussi.
      window.setTimeout(() => navigate('/login', { replace: true }), 2500)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'La réinitialisation a échoué.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth">
      <div className="panel panel--auth">
        <h1>Nouveau mot de passe</h1>

        {done ? (
          <>
            <p className="notice" role="status">
              Mot de passe mis à jour. Vous pouvez maintenant vous connecter.
            </p>
            <Link to="/login" className="btn btn--primary btn--block">
              Se connecter
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="form">
            <label className="field">
              <span className="field__label">Nouveau mot de passe</span>
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

            <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
              {pending ? 'Enregistrement…' : 'Changer mon mot de passe'}
            </button>
          </form>
        )}

        <p className="auth__switch">
          <Link to="/login" className="link">
            Retour à la connexion
          </Link>
        </p>
      </div>
    </div>
  )
}
