/**
 * In-memory mock database.
 *
 * Phase 1's mocks were read-only: the catalogue never wrote anything. Phase 2
 * does — favourites, progress, comments, notifications — so the handlers need
 * somewhere to keep state for the lifetime of the tab. Everything here is
 * deliberately plain and mutable; it is a fixture, not a design.
 *
 * All shapes are typed against the **generated** contract types, so a change
 * in `docs/openapi.yaml` breaks these fixtures at compile time instead of
 * letting the mocks quietly drift away from the real API.
 */
import { animes, mangas } from './data'
import type { components } from '../api/schema'

export type MockUser = components['schemas']['User.jsonld-user.read_user.item.read']
export type MockFavorite = components['schemas']['Favorite.jsonld-favorite.read']
export type MockProgress = components['schemas']['Progress.jsonld-progress.read']
export type MockComment = components['schemas']['Comment.jsonld-comment.read']
export type MockNotification = components['schemas']['Notification.jsonld-notification.read']
export type MockEpisode = components['schemas']['Episode.jsonld-anime.read_anime.item.read']
export type MockChapter = components['schemas']['Chapter.jsonld-manga.read_manga.item.read']

/**
 * The demo account. Documented in `frontend/README.md` so anyone running with
 * `VITE_USE_MOCKS=true` can actually sign in.
 */
export const DEMO_CREDENTIALS = { email: 'demo@manga-stream.test', password: 'demo1234' }

let nextId = 1
const takeId = () => nextId++

export const users: MockUser[] = [
  {
    '@id': '/api/users/1',
    '@type': 'User',
    id: 1,
    email: DEMO_CREDENTIALS.email,
    username: 'demo',
    roles: ['ROLE_USER'],
    createdAt: new Date('2025-01-15T10:00:00Z').toISOString(),
  },
]
nextId = 100 // Keep generated ids clear of the seeded ones.

/** Passwords are obviously not hashed here — this is a mock, not a backend. */
export const passwords = new Map<string, string>([
  [DEMO_CREDENTIALS.email, DEMO_CREDENTIALS.password],
])

export const favorites: MockFavorite[] = []
export const progress: MockProgress[] = []
export const comments: MockComment[] = []
export const notifications: MockNotification[] = []

/* ── Episodes & chapters ──────────────────────────────────────────────────
 * Dérivés d'`episodeCount` / `chapterCount` plutôt qu'écrits à la main : le
 * but est d'exercer l'UI, pas d'être exact.
 *
 * ── Calés sur la lacunarité réelle ────────────────────────────────────────
 * Les proportions ci-dessous reproduisent ce que l'import AniList a
 * effectivement produit en base le 2026-08-02, parce que c'est le cas que
 * l'interface doit tenir :
 *
 *   épisodes  4 392 au total — 1 782 avec titre (~40 %), 1 795 avec vignette,
 *             1 005 avec date de diffusion (~23 %), durée partout ;
 *   chapitres 13 536 au total — **0** titre, **0** pagination, **0** date,
 *             **0** URL. Le type `Media` d'AniList ne liste aucun chapitre :
 *             le backend les dérive du seul `chapterCount`.
 *
 * Des mocks plus riches que la réalité donneraient une fausse assurance : ils
 * valideraient un rendu que le vrai backend ne produira jamais.
 *
 * Les plafonds dépassent la taille d'une tranche (50) pour que la pagination
 * de `UnitList` soit réellement parcourue en mode mocké.
 */

const EPISODE_CAP = 120
const CHAPTER_CAP = 180

export function episodesFor(animeId: number, episodeCount: number | null | undefined): MockEpisode[] {
  const total = Math.min(episodeCount ?? 0, EPISODE_CAP)
  return Array.from({ length: total }, (_, index) => {
    const number = index + 1
    // ~40 % de titres, ~40 % de vignettes, ~23 % de dates : les champs absents
    // sont omis comme le fait API Platform, pas sérialisés à null.
    const hasTitle = number % 5 < 2
    const hasThumb = number % 5 < 2
    const hasDate = number % 13 < 3

    return {
      '@id': `/api/episodes/${animeId}-${number}`,
      '@type': 'Episode',
      id: animeId * 1000 + number,
      number,
      ...(hasTitle ? { title: `Le ${number}e jour` } : {}),
      duration: 24,
      ...(hasDate ? { airDate: new Date(Date.UTC(2023, 0, 1 + number * 7)).toISOString() } : {}),
      ...(hasThumb ? { thumbnail: `https://placehold.co/320x180?text=EP${number}` } : {}),
      ...(hasThumb ? { streamUrl: `https://example.invalid/watch/${animeId}/${number}` } : {}),
    }
  })
}

export function chaptersFor(mangaId: number, chapterCount: number | null | undefined): MockChapter[] {
  const total = Math.min(chapterCount ?? 0, CHAPTER_CAP)
  return Array.from({ length: total }, (_, index) => {
    const number = index + 1
    // `Chapter.number` est un `decimal(8,2)` sérialisé en **string** ("12.50").
    // Le vrai backend n'émet que des entiers, mais un demi-chapitre tous les
    // cinq garde la couverture du cas que la colonne existe pour : l'UI ne
    // doit ni arrondir "12.50" en 13, ni le traiter comme un number.
    const value = number % 5 === 0 ? `${number}.50` : `${number}.00`
    return {
      '@id': `/api/chapters/${mangaId}-${number}`,
      '@type': 'Chapter',
      id: mangaId * 1000 + number,
      number: value,
      // Rien d'autre : c'est exactement ce que sert le backend
      // (`{"@id":…,"@type":"Chapter","id":2334,"number":"1.00"}`, relevé réel).
    }
  })
}

/* ── Lookups the handlers need ────────────────────────────────────────────── */

export function findUserByIri(iri: string): MockUser | undefined {
  return users.find((user) => user['@id'] === iri)
}

export function findUserByEmail(email: string): MockUser | undefined {
  return users.find((user) => user.email.toLowerCase() === email.toLowerCase())
}

export function createUser(email: string, username: string, password: string): MockUser {
  const id = takeId()
  const user: MockUser = {
    '@id': `/api/users/${id}`,
    '@type': 'User',
    id,
    email,
    username,
    roles: ['ROLE_USER'],
    createdAt: new Date().toISOString(),
  }
  users.push(user)
  passwords.set(email, password)
  return user
}

/** Trimmed anime/manga projection, matching the `favorite.read` group. */
export function mediaRefFor(iri: string) {
  const anime = animes.find((item) => item['@id'] === iri)
  if (anime) {
    return {
      kind: 'anime' as const,
      ref: {
        '@id': anime['@id'],
        '@type': 'Anime',
        id: anime.id,
        titleRomaji: anime.titleRomaji,
        titleEnglish: anime.titleEnglish ?? null,
        coverImage: anime.coverImage ?? null,
        episodeCount: anime.episodeCount ?? null,
      },
    }
  }

  const manga = mangas.find((item) => item['@id'] === iri)
  if (manga) {
    return {
      kind: 'manga' as const,
      ref: {
        '@id': manga['@id'],
        '@type': 'Manga',
        id: manga.id,
        titleRomaji: manga.titleRomaji,
        titleEnglish: manga.titleEnglish ?? null,
        coverImage: manga.coverImage ?? null,
        chapterCount: manga.chapterCount ?? null,
      },
    }
  }

  return null
}

export { takeId }

/**
 * Seeds a couple of notifications so the bell has something to show without a
 * Mercure hub. Called once, when the worker starts.
 */
export function seedNotifications(userIri: string): void {
  if (notifications.length > 0) return
  const user = findUserByIri(userIri)
  if (!user) return

  const base = { '@type': 'Notification', user: { '@id': user['@id'], '@type': 'User', id: user.id } }

  notifications.push(
    {
      ...base,
      '@id': `/api/notifications/${takeId()}`,
      id: nextId,
      type: 'NEW_EPISODE',
      payload: { title: 'Sousou no Frieren', number: '12', animeIri: animes[0]?.['@id'] ?? '' },
      isRead: false,
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    } as MockNotification,
    {
      ...base,
      '@id': `/api/notifications/${takeId()}`,
      id: nextId,
      type: 'SYSTEM',
      payload: { message: 'Bienvenue sur manga-stream — ceci est une notification simulée.' },
      isRead: true,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    } as MockNotification,
  )
}
