import { Link, useParams } from 'react-router-dom'

/**
 * Phase 1 placeholder. The detail / profile / favourites screens are built in
 * phase 2; these routes exist now so navigation and deep links already resolve.
 */
export function ComingSoon({ title, note }: { title: string; note?: string }) {
  const params = useParams()
  const id = params.id

  return (
    <div className="panel panel--page">
      <span className="badge">Phase 2</span>
      <h1>{title}</h1>
      {id && (
        <p>
          Ressource demandée : <code>#{id}</code>
        </p>
      )}
      <p>{note ?? 'Cet écran arrive bientôt.'}</p>
      <Link to="/" className="btn">
        Retour au catalogue
      </Link>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <div className="panel panel--page">
      <span className="badge">404</span>
      <h1>Page introuvable</h1>
      <p>Cette adresse ne correspond à aucun écran.</p>
      <Link to="/" className="btn">
        Retour au catalogue
      </Link>
    </div>
  )
}
