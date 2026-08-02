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
 * Lit une clé du payload comme du texte.
 *
 * ⚠️ Le contrat type le payload en `Record<string, string | null>`, ce que le
 * backend **ne respecte pas** : les charges réelles contiennent des entiers
 * (`commentId`, `episodeNumber`, `created`, `skipped`). Relevé en base :
 *
 *   {"commentId":15,"commentIri":"/api/comments/15","authorUsername":"…","excerpt":"…"}
 *   {"animeId":8,"animeIri":"/api/animes/8","animeTitle":"ONE PIECE","episodeNumber":1148}
 *
 * D'où le passage par `unknown` : appeler une méthode de chaîne sur un nombre
 * lèverait à l'exécution alors que le compilateur ne voit rien. Écart de
 * contrat à remonter, mais la lecture défensive a de toute façon sa place —
 * le payload est du JSON libre côté base.
 */
function text(payload: Record<string, string | null>, key: string): string | null {
  const value: unknown = payload[key]
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/**
 * Rend le payload lisible.
 *
 * Les clés sont celles réellement émises par le backend depuis le 2026-08-02
 * (`CommentNotifyProcessor`, `SyncAnilistEpisodesHandler`), vérifiées sur les
 * lignes en base. Les orthographes alternatives sont conservées en repli : le
 * payload n'est contraint par aucun schéma, et un libellé approximatif vaut
 * mieux qu'une ligne vide.
 */
function describe(type: NotificationType, payload: Record<string, string | null>): string {
  const title =
    text(payload, 'animeTitle') ??
    text(payload, 'mangaTitle') ??
    text(payload, 'title') ??
    text(payload, 'mediaTitle')
  const number =
    text(payload, 'episodeNumber') ??
    text(payload, 'chapterNumber') ??
    text(payload, 'number') ??
    text(payload, 'episode') ??
    text(payload, 'chapter')

  switch (type) {
    case 'NEW_EPISODE': {
      if (!title) return number ? `Nouvel épisode ${number}` : 'Nouvel épisode'
      return number ? `Épisode ${number} de ${title}` : `Nouvel épisode de ${title}`
    }
    case 'NEW_CHAPTER': {
      if (!title) return number ? `Nouveau chapitre ${number}` : 'Nouveau chapitre'
      return number ? `Chapitre ${number} de ${title}` : `Nouveau chapitre de ${title}`
    }
    case 'COMMENT_REPLY': {
      const author = text(payload, 'authorUsername') ?? text(payload, 'author')
      const excerpt = text(payload, 'excerpt')
      const who = author ? `${author} a répondu à votre commentaire` : 'Réponse à votre commentaire'
      return excerpt ? `${who} : « ${excerpt} »` : who
    }
    case 'RECOMMENDATION':
      return title ? `Recommandé pour vous : ${title}` : 'Nouvelle recommandation'
    default: {
      // SYSTEM : soit un message libre, soit un compte rendu de campagne
      // d'import (`{"event":"catalogue.chapters.derived","created":13536,…}`).
      const message = text(payload, 'message')
      if (message) return message
      const event = text(payload, 'event')
      const created = text(payload, 'created')
      if (event) return created ? `${event} — ${created} entrées créées` : event
      return NOTIFICATION_LABELS[type]
    }
  }
}

/**
 * Déduit une route interne de l'IRI que porte le payload.
 *
 * `NEW_EPISODE` transporte `animeIri`, produite par l'`IriConverter` du
 * backend : elle reste exacte si la route bouge. `COMMENT_REPLY` ne porte que
 * des IRIs de commentaire, sans le média auquel il se rattache — impossible
 * d'en dériver une page, et fabriquer un lien approximatif serait pire que
 * pas de lien. La notification reste lisible grâce à l'extrait.
 */
function linkFor(payload: Record<string, string | null>): string | null {
  const candidates = [
    text(payload, 'animeIri'),
    text(payload, 'anime'),
    text(payload, 'mangaIri'),
    text(payload, 'manga'),
    text(payload, 'iri'),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const id = idFromIri(candidate)
    if (id === null) continue
    if (candidate.includes('/animes/')) return `/anime/${id}`
    if (candidate.includes('/mangas/')) return `/manga/${id}`
  }
  return null
}

function toEntry(notification: NotificationResource): NotificationEntry {
  const payload = notification.payload ?? {}
  const iri = notification['@id']

  return {
    iri,
    id: notification.id ?? idFromIri(iri),
    type: notification.type,
    // Read straight off the resource since 2026-08-02. During phase 2 the
    // backend did not serialise `isRead` at all (the accessor was named
    // `isRead()`, which Symfony PropertyInfo reads as the getter of a `read`
    // property), so the front had to infer it from a second `?isRead=false`
    // query. The accessor is now `getIsRead()`, the field is in every response
    // — verified against the running backend — and both crutches are gone.
    isRead: notification.isRead,
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
      const result = await apiClient.GET('/api/notifications', {
        params: {
          query: { user: userIri as string, itemsPerPage: 50, 'order[createdAt]': 'desc' },
        },
      })
      return normalizeCollection(unwrap(result)).member.map(toEntry)
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
