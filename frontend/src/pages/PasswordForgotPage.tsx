import { useState } from 'react'
import { Link } from 'react-router-dom'
import { RateLimitError, requestPasswordReset } from '../api/password'

/**
 * « Mot de passe oublié ? » — demande d'un email de réinitialisation.
 *
 * ── La confirmation est neutre, et c'est le point de l'écran ──────────────
 * Le backend répond 204 que l'adresse existe ou non, exprès : sinon la page
 * devient un oracle permettant de tester si telle personne a un compte ici.
 * L'interface doit tenir la même ligne. Concrètement :
 *
 *   - un seul message de succès, « si un compte existe… », jamais « email
 *     envoyé » (qui confirmerait l'existence) ni « adresse inconnue » ;
 *   - le formulaire est remplacé par ce message, pour ne pas inviter à
 *     réessayer d'autres adresses ;
 *   - aucun délai artificiel n'est ajouté ni retiré, aucune erreur n'est
 *     dérivée du contenu de la réponse.
 *
 * Un 429 fait exception : c'est une limite de débit, pas une information sur le
 * compte, et la taire laisserait l'utilisateur devant un formulaire qui semble
 * ne rien faire.
 */
export function PasswordForgotPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await requestPasswordReset(email.trim())
      setSent(true)
    } catch (caught) {
      // `RateLimitError` porte déjà le délai de `Retry-After` dans son message.
      setError(
        caught instanceof RateLimitError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'La demande a échoué.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth">
      <div className="panel panel--auth">
        <h1>Mot de passe oublié</h1>

        {sent ? (
          <>
            <p className="notice" role="status">
              Si un compte existe pour cette adresse, un email contenant un lien de
              réinitialisation vient d’être envoyé. Le lien est valable un temps limité.
            </p>
            <p className="muted">
              Pensez à regarder dans les indésirables. Vous pouvez fermer cette page.
            </p>
            <p className="auth__switch">
              <Link to="/login" className="link">
                Retour à la connexion
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="muted">
              Indiquez l’adresse de votre compte : nous vous enverrons un lien pour choisir un
              nouveau mot de passe.
            </p>

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

              {error && (
                <p className="form__error" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
                {pending ? 'Envoi…' : 'Envoyer le lien'}
              </button>
            </form>

            <p className="auth__switch">
              <Link to="/login" className="link">
                Retour à la connexion
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
