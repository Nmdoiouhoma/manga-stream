/**
 * Notifications: the bell, its unread counter, and the read-marking.
 *
 * The list is polled lazily (React Query default: on mount / on demand) and
 * pushed to by Mercure — see `hooks/useMercure.ts`. Mercure is a *bonus*: if
 * the hub never answers, the bell still works, it just refreshes when the user
 * opens it instead of instantly.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from './client'
import { normalizeCollection } from './hydra'
import { useAuth } from '../auth/useAuth'
import { idFromIri } from '../types/media'
import type { components } from './schema'

type NotificationResource = components['schemas']['Notification.jsonld-notification.read']

export type NotificationType = NotificationResource['type']

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  NEW_EPISODE: 'Nouvel épisode',
  NEW_CHAPTER: 'Nouveau chapitre',
  COMMENT_REPLY: 'Réponse à un commentaire',
  RECOMMENDATION: 'Recommandation',
  SYSTEM: 'Système',
}

export type NotificationEntry = {
  iri: string
  id: number | null
  type: NotificationType
  isRead: boolean
  createdAt: string | null
  /**
   * Free-form string map in the contract (`{ [key: string]: string | null }`).
   * The backend has not frozen its keys, so the UI reads it defensively and
   * never assumes a field is there.
   */
  payload: Record<string, string | null>
  /** Best-effort human message, derived from the payload. */
  message: string
  /** In-app link derived from the payload, when one can be worked out. */
  href: string | null
}

/**
 * Turns the untyped payload into something displayable.
 *
 * Deliberately tolerant: any of these key spellings may show up depending on
 * how the backend ends up writing them, and an unknown payload degrades to the
 * notification type label rather than to an empty row.
 */
function describe(type: NotificationType, payload: Record<string, string | null>): string {
  const title = payload.title ?? payload.mediaTitle ?? payload.animeTitle ?? payload.mangaTitle
  const number = payload.number ?? payload.episode ?? payload.chapter

  if (payload.message) return payload.message

  switch (type) {
    case 'NEW_EPISODE':
      return title ? `Épisode ${number ?? ''} de ${title}`.replace('  ', ' ') : 'Nouvel épisode'
    case 'NEW_CHAPTER':
      return title ? `Chapitre ${number ?? ''} de ${title}`.replace('  ', ' ') : 'Nouveau chapitre'
    case 'COMMENT_REPLY':
      return payload.author
        ? `${payload.author} a répondu à votre commentaire`
        : 'Réponse à votre commentaire'
    case 'RECOMMENDATION':
      return title ? `Recommandé pour vous : ${title}` : 'Nouvelle recommandation'
    default:
      return NOTIFICATION_LABELS[type]
  }
}

/** Derives an in-app route from whatever IRI the payload happens to carry. */
function linkFor(payload: Record<string, string | null>): string | null {
  const candidates = [payload.animeIri, payload.anime, payload.mangaIri, payload.manga, payload.iri]
  for (const candidate of candidates) {
    if (!candidate) continue
    const id = idFromIri(candidate)
    if (id === null) continue
    if (candidate.includes('/animes/')) return `/anime/${id}`
    if (candidate.includes('/mangas/')) return `/manga/${id}`
  }
  return null
}

/**
 * @param unreadIris IRIs known to be unread, from the `?isRead=false` query.
 *   Used only as a fallback — see `useNotifications`.
 */
function toEntry(notification: NotificationResource, unreadIris: Set<string>): NotificationEntry {
  const payload = notification.payload ?? {}
  const iri = notification['@id']

  return {
    iri,
    id: notification.id ?? idFromIri(iri),
    type: notification.type,
    // The field wins whenever it is there. The fallback exists because the
    // backend spent part of phase 2 **not serialising `isRead` at all** while
    // the contract declared it required — the value was stored fine (`?isRead=`
    // filtered on it correctly), it just never reached the client, so every
    // notification read as unread forever and "mark as read" was undone by the
    // next refetch. Fixed backend-side on 2026-08-02; kept as a safety net
    // until that fix is committed and stable, then delete this branch and the
    // second query in `useNotifications`.
    isRead: typeof notification.isRead === 'boolean' ? notification.isRead : !unreadIris.has(iri),
    createdAt: notification.createdAt ?? null,
    payload,
    message: describe(notification.type, payload),
    href: linkFor(payload),
  }
}

export function notificationsQueryKey(userIri: string | null) {
  return ['notifications', userIri] as const
}

export function useNotifications() {
  const { user } = useAuth()
  const userIri = user?.iri ?? null

  const query = useQuery<NotificationEntry[]>({
    queryKey: notificationsQueryKey(userIri),
    enabled: userIri !== null,
    queryFn: async () => {
      // Two requests on purpose: the second is the fallback source of truth for
      // the unread flag (see `toEntry`). Small, filtered collection; remove it
      // together with the fallback once `isRead` is reliably serialised.
      const [allResult, unreadResult] = await Promise.all([
        apiClient.GET('/api/notifications', {
          params: {
            query: { user: userIri as string, itemsPerPage: 50, 'order[createdAt]': 'desc' },
          },
        }),
        apiClient.GET('/api/notifications', {
          params: { query: { user: userIri as string, itemsPerPage: 50, isRead: false } },
        }),
      ])

      const unreadIris = new Set(
        normalizeCollection(unwrap(unreadResult)).member.map((item) => item['@id']),
      )
      return normalizeCollection(unwrap(allResult)).member.map((item) => toEntry(item, unreadIris))
    },
  })

  const entries = query.data ?? []
  return { ...query, entries, unreadCount: entries.filter((entry) => !entry.isRead).length }
}

/**
 * Marks one or several notifications as read.
 *
 * The contract has no bulk operation, so "tout marquer comme lu" is N parallel
 * PATCHes. `Promise.allSettled` rather than `Promise.all`: one failing PATCH
 * should not discard the others' success — the final refetch reconciles.
 */
export function useMarkNotificationsRead() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userIri = user?.iri ?? null
  const key = notificationsQueryKey(userIri)

  return useMutation({
    mutationFn: async (entries: NotificationEntry[]) => {
      const targets = entries.filter((entry) => !entry.isRead && entry.id !== null)
      if (targets.length === 0) return

      await Promise.allSettled(
        targets.map((entry) =>
          apiClient.PATCH('/api/notifications/{id}', {
            params: { path: { id: String(entry.id) } },
            body: { isRead: true, type: entry.type },
            // The only request content type the contract declares for PATCH.
            headers: { 'Content-Type': 'application/merge-patch+json' },
          }),
        ),
      )
    },

    onMutate: async (entries: NotificationEntry[]) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<NotificationEntry[]>(key) ?? []
      const marked = new Set(entries.map((entry) => entry.iri))
      queryClient.setQueryData(
        key,
        previous.map((entry) => (marked.has(entry.iri) ? { ...entry, isRead: true } : entry)),
      )
      return { previous }
    },

    onError: (_error, _entries, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}
