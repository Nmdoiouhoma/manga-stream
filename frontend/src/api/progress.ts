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
import { idFromIri, parseDecimal, toDecimalString, type MediaKind } from '../types/media'
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
  /**
   * Total annoncé par le catalogue : `episodeCount` pour un anime,
   * `chapterCount` pour un manga. `null` quand AniList ne le donne pas, ce qui
   * est fréquent sur les séries en cours.
   */
  targetUnitCount: number | null
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
    // Les deux groupes de lecture n'exposent pas le même champ : `episodeCount`
    // côté anime, `chapterCount` côté manga. Le `in` est donc un vrai test,
    // pas une précaution — sans lui, le total d'un manga serait perdu.
    targetUnitCount:
      'episodeCount' in target
        ? (target.episodeCount ?? null)
        : 'chapterCount' in target
          ? (target.chapterCount ?? null)
          : null,
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

/** Maximum autorisé par le contrat (`itemsPerPage`, `maximum: 100`). */
const PAGE_SIZE = 100
/**
 * Garde-fou : 20 pages = 2 000 titres suivis, très au-delà d'une liste
 * humaine. Sert uniquement à ne pas boucler indéfiniment si le serveur
 * annonçait un `next` perpétuel.
 */
const MAX_PAGES = 20

/**
 * Every progress entry of the current user — la matière première de « Ma liste »
 * et du profil.
 *
 * ── Pourquoi on pagine ────────────────────────────────────────────────────
 * Une seule page de 100 suffisait tant que la progression n'était lue que par
 * fiche. « Ma liste » la lit en entier, et un compteur d'onglet faux est pire
 * qu'absent : au-delà de 100 titres suivis, les suivants disparaissaient
 * purement et simplement — y compris de `useMediaProgress`, qui aurait alors
 * proposé « ajouter à ma liste » sur une œuvre déjà suivie.
 *
 * Les pages sont enchaînées tant que Hydra annonce une suite, pas en parallèle :
 * une liste personnelle tient en une ou deux requêtes, et 20 appels simultanés
 * sur un endpoint authentifié ne servirait qu'à se faire limiter.
 */
export function useProgressList() {
  const { user } = useAuth()
  const userIri = user?.iri ?? null

  const query = useQuery<ProgressEntry[]>({
    queryKey: progressQueryKey(userIri),
    enabled: userIri !== null,
    queryFn: async () => {
      const entries: ProgressEntry[] = []

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const result = await apiClient.GET('/api/progress', {
          params: {
            query: {
              user: userIri as string,
              page,
              itemsPerPage: PAGE_SIZE,
              'order[updatedAt]': 'desc',
            },
          },
        })

        const collection = normalizeCollection(unwrap(result))
        for (const item of collection.member) {
          const entry = toEntry(item)
          if (entry !== null) entries.push(entry)
        }

        // `hasNextPage` vient de `view.next` ; le repli sur la taille de page
        // couvre un backend qui n'émettrait pas la vue Hydra.
        if (!collection.hasNextPage || collection.member.length < PAGE_SIZE) break
      }

      return entries
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
 * Creates or updates the progress entry for one media.
 *
 * PATCH uses `application/merge-patch+json` — the only request content type the
 * contract declares for `PATCH /api/progress/{id}`. `openapi-fetch` would
 * otherwise send `application/json`, which API Platform answers with 415.
 *
 * ── La réponse fait foi ───────────────────────────────────────────────────
 * `App\State\ProgressCompletionProvider` **normalise** un `COMPLETED` dont le
 * compteur est trop bas : il le porte au total et renvoie la valeur corrigée.
 * On relit donc la ressource renvoyée et on l'écrit dans le cache plutôt que
 * de conserver l'optimiste — sinon la ligne afficherait « Terminé · 1/25 »
 * jusqu'au prochain rafraîchissement, alors que le serveur a enregistré 25.
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
        return toEntry(unwrap(result))
      }

      // No `user`: assigned server-side from the JWT (optional since 2026-08-02).
      const result = await apiClient.POST('/api/progress', {
        body: {
          ...(input.kind === 'anime' ? { anime: input.targetIri } : { manga: input.targetIri }),
          ...payload,
        },
      })
      return toEntry(unwrap(result))
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
        targetUnitCount: input.existing?.targetUnitCount ?? null,
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

    // La ressource renvoyée remplace l'optimiste : c'est là, et là seulement,
    // qu'on apprend l'`id` d'une création et la valeur corrigée d'un
    // `COMPLETED` normalisé. Le champ de tri `updatedAt` vient aussi du
    // serveur, ce qui évite de faire sauter la ligne au refetch.
    onSuccess: (saved, input) => {
      if (!saved) return
      const previous = queryClient.getQueryData<ProgressEntry[]>(key) ?? []
      const others = previous.filter((entry) => entry.targetIri !== input.targetIri)
      queryClient.setQueryData(key, [saved, ...others])
    },

    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}
