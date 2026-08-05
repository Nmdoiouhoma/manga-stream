/**
 * Le planning d'une saison : les animes d'un cours donné, les plus attendus
 * d'abord.
 *
 * ── Aucun endpoint dédié, et c'est volontaire ─────────────────────────────
 * `season` et `seasonYear` sont déjà des filtres de la collection `/api/animes`
 * (déclarés dans `docs/openapi.yaml`, index `idx_anime_season` en base), et
 * `order[popularity]` un tri existant. Ajouter une ressource « Planning »
 * aurait signifié un endpoint de plus, une régénération de contrat et un
 * schéma parallèle, pour exactement la même requête. Le planning est une
 * *lecture particulière* du catalogue, pas une nouvelle donnée.
 *
 * ── Popularité, et pas date de diffusion ──────────────────────────────────
 * Le tri naturel serait la date du prochain épisode. AniList l'expose
 * (`nextAiringEpisode`), mais le projet ne l'importe pas : ni la requête
 * GraphQL ni le schéma `Anime` ne le portent. Le classer par popularité
 * décroissante donne un écran utile tout de suite ; trier au jour près
 * demanderait d'étendre l'import et la table, ce qui est une autre tâche.
 */
import { useInfiniteQuery } from '@tanstack/react-query'
import { apiClient, unwrap } from './client'
import { normalizeCollection } from './hydra'
import { animeToMediaItem, type MediaItem } from '../types/media'
import type { SeasonSlot } from '../lib/season'

/** Assez pour couvrir une saison entière en une ou deux pages. */
const PLANNING_PAGE_SIZE = 50

type PlanningPage = {
  items: MediaItem[]
  totalItems: number
  nextPage: number | null
}

async function fetchPlanningPage(slot: SeasonSlot, page: number): Promise<PlanningPage> {
  const result = await apiClient.GET('/api/animes', {
    params: {
      query: {
        season: slot.season,
        seasonYear: slot.year,
        page,
        itemsPerPage: PLANNING_PAGE_SIZE,
        'order[popularity]': 'desc',
      },
    },
  })

  const collection = normalizeCollection(unwrap(result))

  return {
    items: collection.member.map(animeToMediaItem),
    totalItems: collection.totalItems,
    nextPage: collection.hasNextPage ? page + 1 : null,
  }
}

export function usePlanning(slot: SeasonSlot) {
  const query = useInfiniteQuery({
    queryKey: ['planning', slot.season, slot.year],
    queryFn: ({ pageParam }) => fetchPlanningPage(slot, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
  })

  return {
    ...query,
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    totalItems: query.data?.pages[0]?.totalItems ?? 0,
  }
}
