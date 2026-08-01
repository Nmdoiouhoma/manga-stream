import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  NOTIFICATION_LABELS,
  useMarkNotificationsRead,
  useNotifications,
} from '../api/notifications'
import { useNotificationStream } from '../hooks/useNotificationStream'
import { formatDate } from '../types/media'

/**
 * Notification bell + dropdown panel.
 *
 * Real-time is opportunistic: `useNotificationStream` subscribes to Mercure and
 * invalidates the query on a push. When the hub is unreachable the hook settles
 * on `unavailable` and this component simply refetches when the panel opens —
 * the feature degrades, it does not fail. The connection state is surfaced
 * discreetly at the bottom of the panel rather than as an error banner.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { entries, unreadCount, isLoading, refetch } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const streamStatus = useNotificationStream()
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click / Escape — standard dropdown behaviour.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    // Opening is the moment the user cares about freshness — and the fallback
    // when Mercure never delivered anything.
    if (next) void refetch()
  }

  const unread = entries.filter((entry) => !entry.isRead)

  return (
    <div className="bell" ref={containerRef}>
      <button
        type="button"
        className="bell__button"
        onClick={handleToggle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} non lues` : 'Notifications'
        }
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="bell__icon">
          <path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16zM10 20a2 2 0 0 0 4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="bell__badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="bell__panel" role="dialog" aria-label="Notifications">
          <header className="bell__head">
            <strong>Notifications</strong>
            {unread.length > 0 && (
              <button
                type="button"
                className="btn btn--link"
                onClick={() => markRead.mutate(unread)}
                disabled={markRead.isPending}
              >
                Tout marquer comme lu
              </button>
            )}
          </header>

          {isLoading && <p className="bell__empty">Chargement…</p>}

          {!isLoading && entries.length === 0 && (
            <p className="bell__empty">Aucune notification pour le moment.</p>
          )}

          <ul className="bell__list">
            {entries.map((entry) => {
              const body = (
                <>
                  <span className="bell__type">{NOTIFICATION_LABELS[entry.type]}</span>
                  <span className="bell__message">{entry.message}</span>
                  {entry.createdAt && (
                    <time className="bell__date" dateTime={entry.createdAt}>
                      {formatDate(entry.createdAt)}
                    </time>
                  )}
                </>
              )

              return (
                <li key={entry.iri} className={entry.isRead ? '' : 'is-unread'}>
                  {entry.href ? (
                    <Link
                      to={entry.href}
                      className="bell__item"
                      onClick={() => {
                        setOpen(false)
                        if (!entry.isRead) markRead.mutate([entry])
                      }}
                    >
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="bell__item"
                      onClick={() => !entry.isRead && markRead.mutate([entry])}
                    >
                      {body}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>

          <footer className="bell__foot">
            <StreamIndicator status={streamStatus} />
          </footer>
        </div>
      )}
    </div>
  )
}

function StreamIndicator({ status }: { status: ReturnType<typeof useNotificationStream> }) {
  const label: Record<typeof status, string> = {
    idle: 'Temps réel désactivé',
    connecting: 'Connexion au flux temps réel…',
    open: 'Temps réel actif',
    retrying: 'Reconnexion au flux…',
    unavailable: 'Temps réel indisponible — actualisation manuelle',
  }

  return (
    <span className={`stream stream--${status}`}>
      <span className="stream__dot" aria-hidden="true" />
      {label[status]}
    </span>
  )
}
