/**
 * Favourites — the user's watch/read list.
 *
 * Contract shape (`/api/favorites`): a Favorite points at **either** an anime
 * **or** a manga (`exists[anime]` / `exists[manga]` filters exist precisely
 * because one of the two is always null). The read group embeds a trimmed
 * target — id, titles, cover — which is exactly what a card needs, so the
 * favourites page renders without a second round-trip per entry.
 *
 * Scoping: today `/api/favorites` returns everybody's favourites, so we filter
 * with `?user=<iri>`. The backend is going to restrict the collection to the
 * current user; when it does, the extra parameter becomes a harmless no-op and
 * nothing here needs to change.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from './client'
import { normalizeCollection } from './hydra'
import { useAuth } from '../auth/useAuth'
import { idFromIri, type MediaKind } from '../types/media'
import type { components } from './schema'

type Favorite = components['schemas']['Favorite.jsonld-favorite.read']

/** Contract maximum page size. A personal list realistically fits in one page. */
const PAGE_SIZE = 100

/** A favourite, flattened for the UI. */
export type FavoriteEntry = {
  /** Favorite resource IRI, e.g. "/api/favorites/7". Empty while optimistic. */
  iri: string
  id: number | null
  kind: MediaKind
  /** IRI of the favourited anime/manga, e.g. "/api/animes/3". The real key. */
  targetIri: string
  title: string
  coverImage: string | null
  createdAt: string | null
  /** Route to the detail page. */
  href: string
  /** True while the server has not confirmed the creation yet. */
  pending?: boolean
}

function toEntry(favorite: Favorite): FavoriteEntry | null {
  const target = favorite.anime ?? favorite.manga
  if (!target) return null // Contract allows it; a favourite pointing at nothing is unusable.
  const kind: MediaKind = favorite.anime ? 'anime' : 'manga'
  const targetIri = target['@id']
  const id = target.id ?? idFromIri(targetIri)

  return {
    iri: favorite['@id'],
    id: favorite.id ?? idFromIri(favorite['@id']),
    kind,
    targetIri,
    title: target.titleEnglish?.trim() || target.titleRomaji?.trim() || 'Sans titre',
    coverImage: target.coverImage ?? null,
    createdAt: favorite.createdAt ?? null,
    href: id !== null ? `/${kind}/${id}` : '/',
  }
}

export function favoritesQueryKey(userIri: string | null) {
  return ['favorites', userIri] as const
}

/**
 * The current user's favourites. Returns an empty list (never an error) when
 * nobody is signed in, so the favourite button can render everywhere without
 * every caller branching on auth.
 */
export function useFavorites() {
  const { user } = useAuth()
  const userIri = user?.iri ?? null

  const query = useQuery<FavoriteEntry[]>({
    queryKey: favoritesQueryKey(userIri),
    enabled: userIri !== null,
    queryFn: async () => {
      const result = await apiClient.GET('/api/favorites', {
        params: {
          query: {
            user: userIri as string,
            itemsPerPage: PAGE_SIZE,
            'order[createdAt]': 'desc',
          },
        },
      })
      return normalizeCollection(unwrap(result))
        .member.map(toEntry)
        .filter((entry): entry is FavoriteEntry => entry !== null)
    },
  })

  return { ...query, entries: query.data ?? [] }
}

/** Fast "is this favourited?" lookup, keyed by target IRI. */
export function useFavoriteIndex(): Map<string, FavoriteEntry> {
  const { entries } = useFavorites()
  return new Map(entries.map((entry) => [entry.targetIri, entry]))
}

type ToggleInput = {
  targetIri: string
  kind: MediaKind
  title: string
  coverImage: string | null
  /** The existing favourite, when the target is already in the list. */
  existing?: FavoriteEntry
}

/**
 * Adds or removes a favourite, **optimistically**.
 *
 * The cached list is patched before the request leaves, so the heart fills
 * instantly. `onMutate` snapshots the previous list and `onError` puts it back
 * verbatim — a failed toggle leaves no trace. `onSettled` refetches so the
 * optimistic entry (which has no real IRI yet) is replaced by the server's.
 *
 * Concurrency: `cancelQueries` first, otherwise an in-flight refetch could land
 * after the optimistic patch and undo it.
 */
export function useToggleFavorite() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userIri = user?.iri ?? null
  const key = favoritesQueryKey(userIri)

  return useMutation({
    mutationFn: async ({ targetIri, kind, existing }: ToggleInput) => {
      if (!userIri) throw new Error('Connectez-vous pour gérer vos favoris.')

      if (existing) {
        // Optimistic entries have no id yet — refuse rather than DELETE /api/favorites/null.
        if (existing.id === null) throw new Error('Favori en cours d’enregistrement, réessayez.')
        const result = await apiClient.DELETE('/api/favorites/{id}', {
          params: { path: { id: String(existing.id) } },
        })
        // 204 No Content: `data` is undefined on success, so `unwrap` cannot be used.
        if (result.error) throw asError(result)
        return null
      }

      const result = await apiClient.POST('/api/favorites', {
        body: {
          user: userIri,
          ...(kind === 'anime' ? { anime: targetIri } : { manga: targetIri }),
        },
      })
      return unwrap(result)
    },

    onMutate: async (input: ToggleInput) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<FavoriteEntry[]>(key) ?? []

      const next = input.existing
        ? previous.filter((entry) => entry.targetIri !== input.targetIri)
        : [
            {
              iri: '',
              id: null,
              kind: input.kind,
              targetIri: input.targetIri,
              title: input.title,
              coverImage: input.coverImage,
              createdAt: new Date().toISOString(),
              href: hrefFor(input.kind, input.targetIri),
              pending: true,
            },
            ...previous,
          ]

      queryClient.setQueryData(key, next)
      return { previous }
    },

    onError: (_error, _input, context) => {
      // Rollback: restore the exact list we had before touching it.
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}

function hrefFor(kind: MediaKind, targetIri: string): string {
  const id = idFromIri(targetIri)
  return id !== null ? `/${kind}/${id}` : '/'
}

/** Turns an `openapi-fetch` error result into something throwable. */
function asError(result: { error?: unknown; response: Response }): Error {
  const detail =
    typeof result.error === 'object' && result.error !== null && 'detail' in result.error
      ? String((result.error as { detail: unknown }).detail)
      : `Échec de la requête (${result.response.status})`
  return new Error(detail)
}

/** Drops every favourite-related cache entry. Used on logout. */
export function clearFavoritesCache(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: ['favorites'] })
}
