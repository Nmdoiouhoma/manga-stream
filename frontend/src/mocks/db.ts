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
 * Derived from `episodeCount` / `chapterCount` rather than hand-written: the
 * point of the mock list is to exercise the UI (ordering, decimal chapter
 * numbers, missing titles), not to be accurate.
 */

const EPISODE_CAP = 24
const CHAPTER_CAP = 20

export function episodesFor(animeId: number, episodeCount: number | null | undefined): MockEpisode[] {
  const total = Math.min(episodeCount ?? 0, EPISODE_CAP)
  return Array.from({ length: total }, (_, index) => {
    const number = index + 1
    return {
      '@id': `/api/episodes/${animeId}-${number}`,
      '@type': 'Episode',
      id: animeId * 1000 + number,
      number,
      // Every third episode has no title, to exercise the fallback label.
      title: number % 3 === 0 ? null : `Épisode ${number}`,
      duration: 24,
      airDate: new Date(Date.UTC(2023, 0, 1 + number * 7)).toISOString(),
      thumbnail: null,
      streamUrl: null,
    }
  })
}

export function chaptersFor(mangaId: number, chapterCount: number | null | undefined): MockChapter[] {
  const total = Math.min(chapterCount ?? 0, CHAPTER_CAP)
  return Array.from({ length: total }, (_, index) => {
    const number = index + 1
    // Every fifth entry is a half-chapter, because `Chapter.number` is a
    // `decimal(8,2)` serialised as a **string** and the UI must not round it.
    const value = number % 5 === 0 ? `${number}.50` : `${number}.00`
    return {
      '@id': `/api/chapters/${mangaId}-${number}`,
      '@type': 'Chapter',
      id: mangaId * 1000 + number,
      number: value,
      title: number % 4 === 0 ? null : `Chapitre ${number}`,
      pageCount: 18 + (number % 5),
      releaseDate: new Date(Date.UTC(2022, 0, 1 + number * 14)).toISOString(),
      readUrl: null,
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
