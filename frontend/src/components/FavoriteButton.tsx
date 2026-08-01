import { useNavigate } from 'react-router-dom'
import { useFavoriteIndex, useToggleFavorite } from '../api/favorites'
import { useAuth } from '../auth/useAuth'
import type { MediaKind } from '../types/media'

type Props = {
  targetIri: string
  kind: MediaKind
  title: string
  coverImage: string | null
  /** `icon` sits on a card, `full` on a detail page and carries a label. */
  variant?: 'icon' | 'full'
}

/**
 * Favourite toggle. Same component on the cards and on the detail pages.
 *
 * Anonymous users are not shown a disabled button — they get one that sends
 * them to `/login` with a return path, which is a far less frustrating dead end.
 *
 * The optimistic update lives in `useToggleFavorite`; here we only reflect it.
 * `isPending` is intentionally *not* used to disable the button: the cache
 * already shows the new state, so blocking the control would just make an
 * un-toggle feel laggy. The only guard is against double-submitting an entry
 * that has no server id yet.
 */
export function FavoriteButton({ targetIri, kind, title, coverImage, variant = 'icon' }: Props) {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const index = useFavoriteIndex()
  const toggle = useToggleFavorite()

  const existing = index.get(targetIri)
  const isFavorite = existing !== undefined
  const isSyncing = existing?.pending === true

  const handleClick = (event: React.MouseEvent) => {
    // The cards are wrapped in a <Link>: never navigate when hitting the heart.
    event.preventDefault()
    event.stopPropagation()

    if (!isAuthenticated) {
      navigate('/login', { state: { from: window.location.pathname } })
      return
    }
    if (isSyncing) return

    toggle.mutate({ targetIri, kind, title, coverImage, existing })
  }

  const label = isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'

  return (
    <button
      type="button"
      className={`fav fav--${variant} ${isFavorite ? 'is-active' : ''}`}
      onClick={handleClick}
      aria-pressed={isFavorite}
      aria-label={label}
      title={isAuthenticated ? label : 'Connectez-vous pour gérer vos favoris'}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="fav__icon">
        <path d="M12 20.5 4.2 13a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1A4.8 4.8 0 0 1 19.8 13z" />
      </svg>
      {variant === 'full' && <span>{isFavorite ? 'Dans vos favoris' : 'Ajouter aux favoris'}</span>}
    </button>
  )
}
