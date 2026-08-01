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

/**
 * Read models as served on the **item** endpoints. The contract adds the
 * `*.item.read` group there, which is what embeds `episodes[]` / `chapters[]`.
 */
export type AnimeDetail = components['schemas']['Anime.jsonld-anime.read_anime.item.read']
export type MangaDetail = components['schemas']['Manga.jsonld-manga.read_manga.item.read']
export type Episode = components['schemas']['Episode.jsonld-anime.read_anime.item.read']
export type Chapter = components['schemas']['Chapter.jsonld-manga.read_manga.item.read']

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

/* ────────────────────────────── Detail pages ────────────────────────────── */

/**
 * A normalised detail entry. Same idea as `MediaItem` — animes and mangas share
 * one screen — but carrying everything the item endpoint adds: banner, native
 * title, dates, and the embedded episode/chapter list.
 */
export type MediaDetail = MediaItem & {
  titleRomaji: string
  titleEnglish: string | null
  titleNative: string | null
  bannerImage: string | null
  startDate: string | null
  endDate: string | null
  /** Anime only, empty for a manga. Sorted by number. */
  episodes: Episode[]
  /** Manga only, empty for an anime. Sorted by number. */
  chapters: Chapter[]
  /** Total episodes (anime) or chapters (manga) as announced by the catalogue. */
  unitCount: number | null
  volumeCount: number | null
}

export function animeToMediaDetail(anime: AnimeDetail): MediaDetail {
  // `AnimeDetail` is `Anime` plus the item-read extras, so the collection-level
  // projection can be reused verbatim rather than duplicated.
  const base = animeToMediaItem(anime as Anime)
  return {
    ...base,
    titleRomaji: anime.titleRomaji,
    titleEnglish: anime.titleEnglish ?? null,
    titleNative: anime.titleNative ?? null,
    bannerImage: anime.bannerImage ?? null,
    startDate: anime.startDate ?? null,
    endDate: anime.endDate ?? null,
    episodes: [...(anime.episodes ?? [])].sort((a, b) => a.number - b.number),
    chapters: [],
    unitCount: anime.episodeCount ?? null,
    volumeCount: null,
  }
}

export function mangaToMediaDetail(manga: MangaDetail): MediaDetail {
  const base = mangaToMediaItem(manga as Manga)
  return {
    ...base,
    titleRomaji: manga.titleRomaji,
    titleEnglish: manga.titleEnglish ?? null,
    titleNative: manga.titleNative ?? null,
    bannerImage: manga.bannerImage ?? null,
    startDate: null,
    endDate: null,
    episodes: [],
    chapters: [...(manga.chapters ?? [])].sort(
      (a, b) => parseDecimal(a.number) - parseDecimal(b.number),
    ),
    unitCount: manga.chapterCount ?? null,
    volumeCount: manga.volumeCount ?? null,
  }
}

/**
 * Parses a decimal the API serialises as a **string**.
 *
 * `Chapter.number` and `Progress.currentChapter` are `decimal(8,2)` columns.
 * Doctrine + API Platform serialise those as JSON strings ("12.50"), never
 * numbers, precisely so the precision survives the round-trip. Anything doing
 * arithmetic on them must go through here.
 *
 * Tolerates a comma decimal separator and returns `fallback` on garbage rather
 * than letting `NaN` leak into sorts and progress bars.
 */
export function parseDecimal(value: string | number | null | undefined, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value !== 'string') return fallback
  const parsed = Number(value.trim().replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Renders such a decimal for display: "12.50" reads better as "12", and
 * "12.50" must stay "12.5" (a real half-chapter), not become "13".
 */
export function formatChapterNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const parsed = parseDecimal(value, Number.NaN)
  if (!Number.isFinite(parsed)) return String(value)
  return Number.isInteger(parsed) ? String(parsed) : String(Number(parsed.toFixed(2)))
}

/** Formats an ISO date-time as a French short date. Empty input → null. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}
