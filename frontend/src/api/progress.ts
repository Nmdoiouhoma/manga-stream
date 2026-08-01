/**
 * Reading / watching progress.
 *
 * ⚠️ `Progress.currentChapter` is a `decimal(8,2)` column. Doctrine + API
 * Platform serialise it as a **JSON string** ("12.50"), never a number — the
 * generated type says `string | null` and that is not a mistake. Every read
 * goes through `parseDecimal()` and every write sends a string back, because
 * posting a number gets rejected by the deserialiser on a strict setup. Half
 * chapters (12.5) are the whole point of the column, so rounding is not an
 * option either.
 *
 * `currentEpisode` is a plain integer — no such dance.
 *
 * Scoping note: same as favourites — the collection is already restricted to the
 * authenticated user server-side; `?user=<iri>` is sent because the contract
 * documents it, using the canonical `/api/users/{id}` IRI.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from './client'
import { normalizeCollection } from './hydra'
import { useAuth } from '../auth/useAuth'
import { idFromIri, parseDecimal, type MediaKind } from '../types/media'
import type { components } from './schema'

type ProgressResource = components['schemas']['Progress.jsonld-progress.read']

export type ProgressStatus = ProgressResource['status']

export const PROGRESS_STATUSES: ProgressStatus[] = [
  'PLANNED',
  'WATCHING',
  'COMPLETED',
  'PAUSED',
  'DROPPED',
]

export const PROGRESS_STATUS_LABELS: Record<ProgressStatus, string> = {
  WATCHING: 'En cours',
  COMPLETED: 'Terminé',
  PLANNED: 'Prévu',
  DROPPED: 'Abandonné',
  PAUSED: 'En pause',
}

/** Progress, flattened and with the decimal already parsed. */
export type ProgressEntry = {
  iri: string
  id: number | null
  kind: MediaKind
  targetIri: string
  targetTitle: string
  targetCover: string | null
  /** Episode count announced by the catalogue, when known. */
  targetEpisodeCount: number | null
  status: ProgressStatus
  currentEpisode: number | null
  /** Parsed from the contract's decimal string. `null` when unset. */
  currentChapter: number | null
  /** The raw string as served, kept for round-tripping without precision loss. */
  currentChapterRaw: string | null
  /** Personal score, 0-100 on the contract's scale. */
  score: number | null
  updatedAt: string | null
  href: string
}

function toEntry(progress: ProgressResource): ProgressEntry | null {
  const target = progress.anime ?? progress.manga
  if (!target) return null
  const kind: MediaKind = progress.anime ? 'anime' : 'manga'
  const targetIri = target['@id']
  const id = target.id ?? idFromIri(targetIri)

  return {
    iri: progress['@id'],
    id: progress.id ?? idFromIri(progress['@id']),
    kind,
    targetIri,
    targetTitle: target.titleEnglish?.trim() || target.titleRomaji?.trim() || 'Sans titre',
    targetCover: target.coverImage ?? null,
    targetEpisodeCount: 'episodeCount' in target ? (target.episodeCount ?? null) : null,
    status: progress.status,
    currentEpisode: progress.currentEpisode ?? null,
    currentChapter:
      progress.currentChapter != null ? parseDecimal(progress.currentChapter, 0) : null,
    currentChapterRaw: progress.currentChapter ?? null,
    score: progress.score ?? null,
    updatedAt: progress.updatedAt ?? null,
    href: id !== null ? `/${kind}/${id}` : '/',
  }
}

export function progressQueryKey(userIri: string | null) {
  return ['progress', userIri] as const
}

/** Every progress entry of the current user — the profile page's raw material. */
export function useProgressList() {
  const { user } = useAuth()
  const userIri = user?.iri ?? null

  const query = useQuery<ProgressEntry[]>({
    queryKey: progressQueryKey(userIri),
    enabled: userIri !== null,
    queryFn: async () => {
      const result = await apiClient.GET('/api/progress', {
        params: {
          query: {
            user: userIri as string,
            itemsPerPage: 100,
            'order[updatedAt]': 'desc',
          },
        },
      })
      return normalizeCollection(unwrap(result))
        .member.map(toEntry)
        .filter((entry): entry is ProgressEntry => entry !== null)
    },
  })

  return { ...query, entries: query.data ?? [] }
}

/** The progress entry for one media, or `null` when the user never tracked it. */
export function useMediaProgress(targetIri: string | undefined) {
  const { entries, isLoading, isError } = useProgressList()
  const entry = targetIri ? (entries.find((item) => item.targetIri === targetIri) ?? null) : null
  return { entry, isLoading, isError }
}

export type ProgressInput = {
  targetIri: string
  kind: MediaKind
  status: ProgressStatus
  currentEpisode: number | null
  /** Already-parsed value; serialised back to a decimal string on the way out. */
  currentChapter: number | null
  score: number | null
  /** The entry being edited, when there is one. Decides POST vs PATCH. */
  existing?: ProgressEntry | null
}

/**
 * Serialises a chapter number the way the contract wants it: a decimal string
 * with two fraction digits, matching `decimal(8,2)`.
 */
function toDecimalString(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  return value.toFixed(2)
}

/**
 * Creates or updates the progress entry for one media.
 *
 * PATCH uses `application/merge-patch+json` — the only request content type the
 * contract declares for `PATCH /api/progress/{id}`. `openapi-fetch` would
 * otherwise send `application/json`, which API Platform answers with 415.
 */
export function useSaveProgress() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userIri = user?.iri ?? null
  const key = progressQueryKey(userIri)

  return useMutation({
    mutationFn: async (input: ProgressInput) => {
      if (!userIri) throw new Error('Connectez-vous pour suivre votre progression.')

      const payload = {
        status: input.status,
        currentEpisode: input.kind === 'anime' ? input.currentEpisode : null,
        currentChapter: input.kind === 'manga' ? toDecimalString(input.currentChapter) : null,
        score: input.score,
      }

      if (input.existing?.id != null) {
        const result = await apiClient.PATCH('/api/progress/{id}', {
          params: { path: { id: String(input.existing.id) } },
          body: payload,
          headers: { 'Content-Type': 'application/merge-patch+json' },
        })
        return unwrap(result)
      }

      const result = await apiClient.POST('/api/progress', {
        body: {
          user: userIri,
          ...(input.kind === 'anime'
            ? { anime: input.targetIri }
            : { manga: input.targetIri }),
          ...payload,
        },
      })
      return unwrap(result)
    },

    // Optimistic: the form should feel instant, and a failed save must not
    // leave a phantom "saved" state behind.
    onMutate: async (input: ProgressInput) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ProgressEntry[]>(key) ?? []

      const optimistic: ProgressEntry = {
        iri: input.existing?.iri ?? '',
        id: input.existing?.id ?? null,
        kind: input.kind,
        targetIri: input.targetIri,
        targetTitle: input.existing?.targetTitle ?? '',
        targetCover: input.existing?.targetCover ?? null,
        targetEpisodeCount: input.existing?.targetEpisodeCount ?? null,
        status: input.status,
        currentEpisode: input.currentEpisode,
        currentChapter: input.currentChapter,
        currentChapterRaw: toDecimalString(input.currentChapter),
        score: input.score,
        updatedAt: new Date().toISOString(),
        href: input.existing?.href ?? '/',
      }

      const others = previous.filter((entry) => entry.targetIri !== input.targetIri)
      queryClient.setQueryData(key, [optimistic, ...others])
      return { previous }
    },

    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}
