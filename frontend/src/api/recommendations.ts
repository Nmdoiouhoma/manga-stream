/**
 * Recommandations personnalisées — `GET /api/recommendations`.
 *
 * L'endpoint est un **provider custom** (`RecommendationCollectionProvider`) :
 * il recalcule les suggestions de l'utilisateur authentifié si elles sont
 * périmées, et renvoie **volontairement une collection vide** quand le compte
 * n'a aucun favori. C'est un choix de conception du backend, pas une panne :
 * l'écran doit donc distinguer « vide » de « erreur ».
 *
 * ── Le champ `reason`, et pourquoi il est lu défensivement ─────────────────
 * Le contrat type `reason` en `{ [key: string]: string | null }`. **C'est
 * faux** : le backend y sérialise depuis le scoring v2 des tableaux et des
 * nombres. Relevé contre le backend réel le 2026-08-02 :
 *
 *   "reason": {
 *     "strategy":   "genre_cosine_idf",
 *     "genres":     ["mystery", "action", "fantasy", "adventure"],
 *     "affinity":   0.9027,
 *     "quality":    0.81,
 *     "popularity": 0.8303
 *   }
 *
 * `genres` est un `string[]` et les trois métriques sont des `number` — aucun
 * des trois n'entre dans `string | null`. Plutôt que de mentir au compilateur
 * avec un cast direct vers une forme inventée, le payload est repassé en
 * `unknown` et validé champ par champ par `parseReason()`. Conséquence utile :
 * le jour où le backend change sa stratégie (ou revient à `genre_overlap` de
 * la v1, dont le `reason` n'avait pas les mêmes clés), l'écran dégrade au lieu
 * de planter. Écart remonté au backend, à retirer quand le contrat sera juste.
 *
 * Les `genres` sont des **slugs** (`"psychological"`), pas des libellés. Ils
 * sont rendus lisibles via `/api/genres`, déjà en cache pour la barre de
 * filtres du catalogue, avec repli sur le slug capitalisé.
 */
import { useQuery } from '@tanstack/react-query'
import { apiClient, unwrap } from './client'
import { normalizeCollection } from './hydra'
import { useAuth } from '../auth/useAuth'
import { idFromIri, type MediaKind } from '../types/media'
import type { components } from './schema'

type RecommendationResource = components['schemas']['Recommendation.jsonld-recommendation.read']

/** Le contrat plafonne `itemsPerPage` à 100. Une page suffit largement. */
const PAGE_SIZE = 50

/**
 * Le `reason` tel qu'il est *réellement* servi, après validation.
 * Tout est optionnel : c'est une explication, pas une donnée critique.
 */
export type RecommendationReason = {
  /** Ex. `genre_cosine_idf` (v2) ou `genre_overlap` (v1). */
  strategy: string | null
  /** Slugs des genres décisifs, classés par contribution décroissante. */
  genres: string[]
  /** Proximité aux goûts de l'utilisateur, 0-1. */
  affinity: number | null
  /** Qualité intrinsèque du titre, 0-1. */
  quality: number | null
  /** Popularité normalisée, 0-1. */
  popularity: number | null
}

const EMPTY_REASON: RecommendationReason = {
  strategy: null,
  genres: [],
  affinity: null,
  quality: null,
  popularity: null,
}

/** Une métrique n'est retenue que si c'est un nombre fini dans [0, 1]. */
function readRatio(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return null
  return parsed >= 0 && parsed <= 1 ? parsed : null
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  }
  // Tolère une liste sérialisée en CSV, la forme que le contrat *décrit*.
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

/**
 * Valide le `reason` sans faire confiance au type généré.
 * `reason` est déclaré `Record<string, string | null>` par le contrat, ce que
 * le backend ne respecte pas — d'où le passage par `unknown`, qui est un
 * élargissement sûr et non un `any`.
 */
export function parseReason(reason: unknown): RecommendationReason {
  if (typeof reason !== 'object' || reason === null) return EMPTY_REASON
  const record = reason as Record<string, unknown>

  return {
    strategy: typeof record.strategy === 'string' ? record.strategy : null,
    genres: readStringList(record.genres),
    affinity: readRatio(record.affinity),
    quality: readRatio(record.quality),
    popularity: readRatio(record.popularity),
  }
}

/** Une recommandation aplatie pour l'UI. */
export type RecommendationEntry = {
  /** IRI de la recommandation, ex. `/api/recommendations/81`. */
  iri: string
  id: number | null
  kind: MediaKind
  /** IRI de l'anime/manga suggéré — la clé utile (favoris, progression). */
  targetIri: string
  title: string
  /** Second titre, affiché sous le premier quand il diffère. */
  subtitle: string | null
  coverImage: string | null
  /** Score de pertinence, borné à [0, 1]. */
  score: number
  reason: RecommendationReason
  generatedAt: string | null
  href: string
}

/**
 * Le groupe `recommendation.read` n'embarque qu'un extrait de la cible
 * (`@id`, `id`, `titleRomaji`, `titleEnglish`, `coverImage`) — vérifié contre
 * le backend. Pas de genres, pas de statut : la carte se contente de ça, et
 * l'utilisateur clique pour le reste. Une recommandation sans cible est
 * inexploitable et retournée à `null` plutôt que rendue vide.
 */
function toEntry(recommendation: RecommendationResource): RecommendationEntry | null {
  const target = recommendation.anime ?? recommendation.manga
  if (!target) return null

  const kind: MediaKind = recommendation.anime ? 'anime' : 'manga'
  const targetIri = target['@id']
  const targetId = target.id ?? idFromIri(targetIri)

  const romaji = target.titleRomaji?.trim() ?? ''
  const english = target.titleEnglish?.trim() ?? ''
  const title = english || romaji || 'Sans titre'

  return {
    iri: recommendation['@id'],
    id: recommendation.id ?? idFromIri(recommendation['@id']),
    kind,
    targetIri,
    title,
    subtitle: english && romaji && english !== romaji ? romaji : null,
    coverImage: target.coverImage ?? null,
    // Le contrat borne `score` à [0, 1] mais rien ne le garantit à l'exécution,
    // et une barre à 400 % de large casserait la mise en page.
    score: Math.max(0, Math.min(1, recommendation.score ?? 0)),
    reason: parseReason(recommendation.reason),
    generatedAt: recommendation.generatedAt ?? null,
    href: targetId !== null ? `/${kind}/${targetId}` : '/',
  }
}

export function recommendationsQueryKey(userIri: string | null) {
  return ['recommendations', userIri] as const
}

/**
 * Les recommandations de l'utilisateur courant, du meilleur score au moins bon.
 *
 * `order[score]=desc` est envoyé explicitement : le provider trie déjà ainsi
 * (vérifié), mais le tri est ce qui donne son sens à la page et ne doit pas
 * dépendre d'un détail d'implémentation côté serveur.
 *
 * `staleTime` court volontairement : ajouter un favori change les suggestions,
 * et le provider les recalcule côté serveur — inutile de garder longtemps une
 * liste que le backend sait déjà périmée.
 */
export function useRecommendations() {
  const { user } = useAuth()
  const userIri = user?.iri ?? null

  const query = useQuery<RecommendationEntry[]>({
    queryKey: recommendationsQueryKey(userIri),
    enabled: userIri !== null,
    staleTime: 10_000,
    queryFn: async () => {
      const result = await apiClient.GET('/api/recommendations', {
        params: { query: { itemsPerPage: PAGE_SIZE, 'order[score]': 'desc' } },
      })
      return normalizeCollection(unwrap(result))
        .member.map(toEntry)
        .filter((entry): entry is RecommendationEntry => entry !== null)
        .sort((a, b) => b.score - a.score)
    },
  })

  return { ...query, entries: query.data ?? [] }
}
