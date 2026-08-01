/**
 * Bridges the Mercure stream to the notifications React Query cache.
 *
 * Deliberately dumb on purpose: whatever the hub sends, the reaction is
 * "invalidate the notifications query and let the API be the source of truth".
 * Reconstructing a `NotificationEntry` from an unspecified payload would be
 * guesswork — and the backend has not frozen the payload shape. One extra HTTP
 * round-trip per push is a fine price for never displaying an invented row.
 *
 * The only interpretation applied is a **user filter**. Since phase 3 every
 * subscribed topic is user-scoped and `mercureTopicsFor` refuses anything else,
 * so this should never fire — it is kept as defence in depth: the hub accepts
 * anonymous subscribers in dev, and a future backend convention could publish
 * on a shared channel without us noticing.
 */
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useMercure, type MercureStatus } from './useMercure'
import { useAuth } from '../auth/useAuth'
import { MERCURE_URL, mercureTopicsFor } from '../config'
import { notificationsQueryKey } from '../api/notifications'

/** Reads `data.user` whether it is an IRI string or an embedded object. */
function ownerIriOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  const user = record.user
  if (typeof user === 'string') return user
  if (typeof user === 'object' && user !== null) {
    const iri = (user as Record<string, unknown>)['@id']
    if (typeof iri === 'string') return iri
  }
  return null
}

export function useNotificationStream(): MercureStatus {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userIri = user?.iri ?? null
  const topics = mercureTopicsFor(userIri, user?.id ?? null)

  const onMessage = useCallback(
    (data: unknown) => {
      const owner = ownerIriOf(data)
      // Owner known and not us → not ours to react to, whatever the topic said.
      if (owner !== null && userIri !== null && owner !== userIri) return
      void queryClient.invalidateQueries({ queryKey: notificationsQueryKey(userIri) })
    },
    [queryClient, userIri],
  )

  return useMercure({
    hubUrl: MERCURE_URL || null,
    topics,
    onMessage,
    enabled: userIri !== null,
  })
}
