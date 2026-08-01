import { Link } from 'react-router-dom'

/** Catch-all route. The media-specific 404 lives in `MediaDetailPage`. */
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
