/**
 * App-level types, all derived from the generated OpenAPI schema so the
 * contract stays the single source of truth. If `docs/openapi.yaml` changes,
 * these aliases break at compile time instead of failing silently at runtime.
 *
 * Naming note: the API follows the AniList convention —
 *   - titles are split into `titleRomaji` / `titleEnglish` / `titleNative`
 *   - `averageScore` is on a **0-100** scale, not 0-10
 *   - `status` is an uppercase enum (FINISHED, RELEASING, …)
 */
import type { components } from '../api/schema'

/** Read models as served on the collection endpoints, in JSON-LD. */
export type Anime = components['schemas']['Anime.jsonld-anime.read']
export type Manga = components['schemas']['Manga.jsonld-manga.read']
export type Genre = components['schemas']['Genre.jsonld-genre.read']

/** Genre as embedded inside an Anime/Manga payload (same fields, different group). */
export type EmbeddedGenre =
  | components['schemas']['Genre.jsonld-anime.read']
  | components['schemas']['Genre.jsonld-manga.read']

/** The status enum, taken straight from the contract (nullable there). */
export type MediaStatus = NonNullable<Anime['status']>

export const MEDIA_STATUSES: MediaStatus[] = [
  'RELEASING',
  'FINISHED',
  'NOT_YET_RELEASED',
  'HIATUS',
  'CANCELLED',
]

export const STATUS_LABELS: Record<MediaStatus, string> = {
  RELEASING: 'En cours',
  FINISHED: 'Terminé',
  NOT_YET_RELEASED: 'À venir',
  HIATUS: 'En pause',
  CANCELLED: 'Annulé',
}

/** Anime-only enum, used by the `season` filter. */
export type MediaSeason = NonNullable<Anime['season']>

export const SEASON_LABELS: Record<MediaSeason, string> = {
  WINTER: 'Hiver',
  SPRING: 'Printemps',
  SUMMER: 'Été',
  FALL: 'Automne',
}

/** Which collection(s) the catalogue is browsing. */
export type MediaKind = 'anime' | 'manga'
export type MediaKindFilter = MediaKind | 'all'

/**
 * A normalised catalogue entry: animes and mangas share a card, so they are
 * projected onto a common shape rather than special-cased throughout the UI.
 */
export type MediaItem = {
  /** Unique across both collections (ids overlap between animes and mangas). */
  key: string
  /** The resource IRI, e.g. "/api/animes/1" — the contract's real identifier. */
  iri: string
  id: number | null
  kind: MediaKind
  /** Best available display title. */
  title: string
  /** Secondary title shown under the main one when it differs. */
  subtitle: string | null
  synopsis: string
  coverImage: string | null
  /** Raw contract value, 0-100. */
  averageScore: number | null
  status: MediaStatus | null
  /** e.g. "Automne 2023" for an anime, release year otherwise. */
  releaseLabel: string | null
  genres: EmbeddedGenre[]
  /** Kind-specific metric: "24 ép." or "42 tomes". */
  countLabel: string | null
  /** Route to the detail page. */
  href: string
}

/** Extracts the numeric id from an IRI like "/api/animes/12". */
export function idFromIri(iri: string): number | null {
  const last = iri.split('/').pop()
  const parsed = Number(last)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Picks the best display title. `titleRomaji` is the only guaranteed one in the
 * contract; English is preferred when present because it reads better for a
 * francophone audience.
 */
function pickTitle(item: { titleRomaji: string; titleEnglish?: string | null }) {
  const english = item.titleEnglish?.trim()
  const romaji = item.titleRomaji?.trim() || 'Sans titre'
  return {
    title: english || romaji,
    subtitle: english && english !== romaji ? romaji : null,
  }
}

export function animeToMediaItem(anime: Anime): MediaItem {
  const iri = anime['@id']
  const id = anime.id ?? idFromIri(iri)
  const { title, subtitle } = pickTitle(anime)

  const releaseLabel = anime.season
    ? `${SEASON_LABELS[anime.season]}${anime.seasonYear ? ` ${anime.seasonYear}` : ''}`
    : anime.seasonYear
      ? String(anime.seasonYear)
      : null

  return {
    key: `anime-${iri}`,
    iri,
    id,
    kind: 'anime',
    title,
    subtitle,
    synopsis: anime.synopsis ?? '',
    coverImage: anime.coverImage ?? null,
    averageScore: anime.averageScore ?? null,
    status: anime.status ?? null,
    releaseLabel,
    genres: anime.genres ?? [],
    countLabel: anime.episodeCount ? `${anime.episodeCount} ép.` : null,
    href: id !== null ? `/anime/${id}` : '/',
  }
}

export function mangaToMediaItem(manga: Manga): MediaItem {
  const iri = manga['@id']
  const id = manga.id ?? idFromIri(iri)
  const { title, subtitle } = pickTitle(manga)

  return {
    key: `manga-${iri}`,
    iri,
    id,
    kind: 'manga',
    title,
    subtitle,
    synopsis: manga.synopsis ?? '',
    coverImage: manga.coverImage ?? null,
    averageScore: manga.averageScore ?? null,
    status: manga.status ?? null,
    releaseLabel: null,
    genres: manga.genres ?? [],
    countLabel: manga.volumeCount
      ? `${manga.volumeCount} tomes`
      : manga.chapterCount
        ? `${manga.chapterCount} ch.`
        : null,
    href: id !== null ? `/manga/${id}` : '/',
  }
}

/** Formats the 0-100 contract score as the familiar X.X / 10. */
export function formatScore(averageScore: number): string {
  return (averageScore / 10).toFixed(1)
}
