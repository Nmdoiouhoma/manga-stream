/**
 * Mock dataset used by MSW while the backend is not running.
 *
 * Everything here is typed against the GENERATED contract types
 * (`src/api/schema.ts`), so a change in `docs/openapi.yaml` breaks these
 * fixtures at compile time instead of letting the mocks drift from reality.
 *
 * Contract conventions respected here (AniList-derived):
 *   - titles split into `titleRomaji` / `titleEnglish` / `titleNative`
 *   - `averageScore` on a 0-100 scale
 *   - `status` uppercase enum: FINISHED | RELEASING | NOT_YET_RELEASED | CANCELLED | HIATUS
 *   - every resource carries its `@id` IRI and `@type`
 *   - relations are IRIs; `genres` is *embedded* on the read groups, which is
 *     what the contract's `Anime.jsonld-anime.read` declares.
 *
 * Cover images use https://placehold.co/ placeholders on purpose: no real
 * media host (AniList & co.) is referenced from this repository.
 */
import type { Anime, Genre, Manga, MediaSeason, MediaStatus } from '../types/media'

const genreNames = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Fantasy',
  'Horror',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
] as const

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

export const genres: Genre[] = genreNames.map((name, index) => ({
  '@id': `/api/genres/${index + 1}`,
  '@type': 'Genre',
  id: index + 1,
  name,
  slug: slugify(name),
}))

const genreBySlug = new Map(genres.map((genre) => [genre.slug, genre]))

/** Resolves genre slugs to embedded Genre resources. */
const g = (...slugs: string[]): Genre[] =>
  slugs.map((slug) => {
    const genre = genreBySlug.get(slug)
    if (!genre) throw new Error(`Unknown genre slug in mock data: ${slug}`)
    return genre
  })

/** Deterministic placeholder cover — flat colour + title text. */
const cover = (title: string, tint: string) =>
  `https://placehold.co/400x600/${tint}/e9e6ff?text=${encodeURIComponent(title)}`

const banner = (tint: string) => `https://placehold.co/1200x400/${tint}/e9e6ff?text=+`

const iso = (year: number, month = 1, day = 1) =>
  new Date(Date.UTC(year, month - 1, day)).toISOString()

type AnimeSeed = {
  romaji: string
  english?: string
  native: string
  synopsis: string
  /** 0-100, AniList convention. */
  score: number
  status: MediaStatus
  season: MediaSeason
  year: number
  episodes: number
  tint: string
  genres: string[]
}

const animeSeeds: AnimeSeed[] = [
  {
    romaji: 'Hagane no Renkinjutsushi: Fullmetal Alchemist',
    english: 'Fullmetal Alchemist: Brotherhood',
    native: '鋼の錬金術師 FULLMETAL ALCHEMIST',
    synopsis:
      "Deux frères alchimistes cherchent la Pierre philosophale pour réparer un rituel qui leur a coûté leur corps.",
    score: 91,
    status: 'FINISHED',
    season: 'SPRING',
    year: 2009,
    episodes: 64,
    tint: '2b1a3d',
    genres: ['action', 'adventure', 'drama', 'fantasy'],
  },
  {
    romaji: 'Steins;Gate',
    english: 'Steins;Gate',
    native: 'シュタインズ・ゲート',
    synopsis:
      "Un inventeur amateur découvre qu'un four à micro-ondes peut envoyer des messages dans le passé.",
    score: 90,
    status: 'FINISHED',
    season: 'SPRING',
    year: 2011,
    episodes: 24,
    tint: '1f2b3d',
    genres: ['sci-fi', 'drama', 'psychological'],
  },
  {
    romaji: 'Shingeki no Kyojin',
    english: 'Attack on Titan',
    native: '進撃の巨人',
    synopsis:
      "L'humanité survit derrière d'immenses murs, assiégée par des géants dévoreurs d'hommes.",
    score: 89,
    status: 'FINISHED',
    season: 'SPRING',
    year: 2013,
    episodes: 89,
    tint: '3d1f1f',
    genres: ['action', 'drama', 'fantasy'],
  },
  {
    romaji: 'Hunter x Hunter (2011)',
    english: 'Hunter x Hunter',
    native: 'ハンター×ハンター',
    synopsis:
      "Gon part à la recherche de son père et devient Hunter, un métier aussi prestigieux que mortel.",
    score: 90,
    status: 'FINISHED',
    season: 'FALL',
    year: 2011,
    episodes: 148,
    tint: '1f3d2b',
    genres: ['action', 'adventure', 'fantasy'],
  },
  {
    romaji: 'Cowboy Bebop',
    english: 'Cowboy Bebop',
    native: 'カウボーイビバップ',
    synopsis:
      "Un équipage de chasseurs de primes désabusés traverse le système solaire, poursuivi par son passé.",
    score: 86,
    status: 'FINISHED',
    season: 'SPRING',
    year: 1998,
    episodes: 26,
    tint: '25304a',
    genres: ['action', 'sci-fi', 'drama'],
  },
  {
    romaji: 'Death Note',
    english: 'Death Note',
    native: 'デスノート',
    synopsis: "Un lycéen surdoué trouve un carnet qui tue quiconque y voit son nom inscrit.",
    score: 84,
    status: 'FINISHED',
    season: 'FALL',
    year: 2006,
    episodes: 37,
    tint: '1a1a1a',
    genres: ['mystery', 'psychological', 'supernatural'],
  },
  {
    romaji: 'Monster',
    english: 'Monster',
    native: 'モンスター',
    synopsis:
      "Un neurochirurgien sauve un enfant qui devient un tueur en série, et part le traquer à travers l'Europe.",
    score: 88,
    status: 'FINISHED',
    season: 'SPRING',
    year: 2004,
    episodes: 74,
    tint: '2d2a22',
    genres: ['mystery', 'drama', 'psychological'],
  },
  {
    romaji: 'Code Geass: Hangyaku no Lelouch',
    english: 'Code Geass: Lelouch of the Rebellion',
    native: 'コードギアス 反逆のルルーシュ',
    synopsis:
      "Un prince exilé reçoit un pouvoir absolu et déclenche une rébellion contre un empire mondial.",
    score: 87,
    status: 'FINISHED',
    season: 'FALL',
    year: 2006,
    episodes: 50,
    tint: '3a1c2e',
    genres: ['action', 'drama', 'sci-fi'],
  },
  {
    romaji: 'Shinseiki Evangelion',
    english: 'Neon Genesis Evangelion',
    native: '新世紀エヴァンゲリオン',
    synopsis: "Des adolescents pilotent des méchas biologiques contre des entités appelées Anges.",
    score: 85,
    status: 'FINISHED',
    season: 'FALL',
    year: 1995,
    episodes: 26,
    tint: '2b2140',
    genres: ['action', 'drama', 'psychological', 'sci-fi'],
  },
  {
    romaji: 'Mob Psycho 100',
    english: 'Mob Psycho 100',
    native: 'モブサイコ100',
    synopsis:
      "Un collégien au pouvoir psychique colossal essaie surtout de devenir quelqu'un de bien.",
    score: 86,
    status: 'FINISHED',
    season: 'SUMMER',
    year: 2016,
    episodes: 37,
    tint: '1d3a3a',
    genres: ['action', 'comedy', 'supernatural'],
  },
  {
    romaji: 'Vinland Saga',
    english: 'Vinland Saga',
    native: 'ヴィンランド・サガ',
    synopsis: "Thorfinn grandit parmi les Vikings avec une seule idée en tête : venger son père.",
    score: 88,
    status: 'RELEASING',
    season: 'SUMMER',
    year: 2019,
    episodes: 48,
    tint: '243026',
    genres: ['action', 'adventure', 'drama'],
  },
  {
    romaji: 'Kimetsu no Yaiba',
    english: 'Demon Slayer',
    native: '鬼滅の刃',
    synopsis:
      "Après le massacre de sa famille, Tanjiro rejoint les pourfendeurs de démons pour sauver sa sœur.",
    score: 83,
    status: 'RELEASING',
    season: 'SPRING',
    year: 2019,
    episodes: 63,
    tint: '3d2233',
    genres: ['action', 'fantasy', 'supernatural'],
  },
  {
    romaji: 'Jujutsu Kaisen',
    english: 'Jujutsu Kaisen',
    native: '呪術廻戦',
    synopsis: "Un lycéen avale un doigt maudit et hérite du fléau le plus puissant du monde.",
    score: 86,
    status: 'RELEASING',
    season: 'FALL',
    year: 2020,
    episodes: 47,
    tint: '221f3d',
    genres: ['action', 'fantasy', 'supernatural'],
  },
  {
    romaji: 'Spy x Family',
    english: 'Spy x Family',
    native: 'SPY×FAMILY',
    synopsis:
      "Un espion, une tueuse à gages et une télépathe fondent une fausse famille très convaincante.",
    score: 84,
    status: 'RELEASING',
    season: 'SPRING',
    year: 2022,
    episodes: 37,
    tint: '2f3a20',
    genres: ['action', 'comedy', 'slice-of-life'],
  },
  {
    romaji: 'Made in Abyss',
    english: 'Made in Abyss',
    native: 'メイドインアビス',
    synopsis: "Une orpheline descend dans un gouffre sans fond pour retrouver sa mère exploratrice.",
    score: 87,
    status: 'HIATUS',
    season: 'SUMMER',
    year: 2017,
    episodes: 25,
    tint: '1f3340',
    genres: ['adventure', 'drama', 'fantasy', 'horror'],
  },
  {
    romaji: 'Violet Evergarden',
    english: 'Violet Evergarden',
    native: 'ヴァイオレット・エヴァーガーデン',
    synopsis:
      "Une ancienne enfant soldat écrit les lettres des autres pour comprendre ce qu'aimer veut dire.",
    score: 85,
    status: 'FINISHED',
    season: 'WINTER',
    year: 2018,
    episodes: 13,
    tint: '2a2b40',
    genres: ['drama', 'slice-of-life'],
  },
  {
    romaji: 'Shigatsu wa Kimi no Uso',
    english: 'Your Lie in April',
    native: '四月は君の嘘',
    synopsis: "Un pianiste prodige qui n'entend plus son instrument rencontre une violoniste solaire.",
    score: 86,
    status: 'FINISHED',
    season: 'FALL',
    year: 2014,
    episodes: 22,
    tint: '3a2a35',
    genres: ['drama', 'romance', 'slice-of-life'],
  },
  {
    romaji: 'Haikyuu!!',
    english: 'Haikyu!!',
    native: 'ハイキュー!!',
    synopsis: "Un lycéen trop petit pour le volley décide de devenir le meilleur attaquant du pays.",
    score: 87,
    status: 'FINISHED',
    season: 'SPRING',
    year: 2014,
    episodes: 85,
    tint: '2d3320',
    genres: ['comedy', 'drama', 'sports'],
  },
  {
    romaji: 'One Punch Man',
    english: 'One Punch Man',
    native: 'ワンパンマン',
    synopsis: "Un héros capable de tout vaincre d'un seul coup s'ennuie profondément.",
    score: 84,
    status: 'HIATUS',
    season: 'FALL',
    year: 2015,
    episodes: 24,
    tint: '3d3320',
    genres: ['action', 'comedy'],
  },
  {
    romaji: 'Sousou no Frieren',
    english: "Frieren: Beyond Journey's End",
    native: '葬送のフリーレン',
    synopsis:
      "Une elfe immortelle reprend la route après la mort de ses compagnons pour apprendre ce qu'ils étaient.",
    score: 92,
    status: 'NOT_YET_RELEASED',
    season: 'FALL',
    year: 2023,
    episodes: 28,
    tint: '203a3a',
    genres: ['adventure', 'drama', 'fantasy'],
  },
]

export const animes: Anime[] = animeSeeds.map((seed, index) => {
  const id = index + 1
  return {
    '@id': `/api/animes/${id}`,
    '@type': 'Anime',
    id,
    anilistId: 1000 + id,
    titleRomaji: seed.romaji,
    titleEnglish: seed.english ?? null,
    titleNative: seed.native,
    synopsis: seed.synopsis,
    coverImage: cover(seed.english ?? seed.romaji, seed.tint),
    bannerImage: banner(seed.tint),
    episodeCount: seed.episodes,
    averageScore: seed.score,
    status: seed.status,
    season: seed.season,
    seasonYear: seed.year,
    startDate: iso(seed.year, 4, 5),
    endDate: seed.status === 'FINISHED' ? iso(seed.year + 1, 3, 28) : null,
    createdAt: iso(2024, 1, 15),
    updatedAt: iso(2024, 6, 1),
    genres: g(...seed.genres),
  }
})

type MangaSeed = {
  romaji: string
  english?: string
  native: string
  synopsis: string
  score: number
  status: MediaStatus
  year: number
  chapters: number
  volumes: number
  tint: string
  genres: string[]
}

const mangaSeeds: MangaSeed[] = [
  {
    romaji: 'Berserk',
    english: 'Berserk',
    native: 'ベルセルク',
    synopsis: "Guts, mercenaire marqué par un sacrifice, traque les démons qui lui ont tout pris.",
    score: 94,
    status: 'RELEASING',
    year: 1989,
    chapters: 374,
    volumes: 42,
    tint: '2a1a1a',
    genres: ['action', 'adventure', 'drama', 'horror', 'fantasy'],
  },
  {
    romaji: 'Vagabond',
    english: 'Vagabond',
    native: 'バガボンド',
    synopsis: "La vie romancée de Musashi Miyamoto, du sabre brutal à la quête de maîtrise intérieure.",
    score: 92,
    status: 'HIATUS',
    year: 1998,
    chapters: 327,
    volumes: 37,
    tint: '2c281f',
    genres: ['action', 'drama'],
  },
  {
    romaji: 'One Piece',
    english: 'One Piece',
    native: 'ワンピース',
    synopsis: "Luffy et son équipage cherchent le trésor ultime à travers un monde d'îles improbables.",
    score: 92,
    status: 'RELEASING',
    year: 1997,
    chapters: 1100,
    volumes: 108,
    tint: '1f3040',
    genres: ['action', 'adventure', 'comedy', 'fantasy'],
  },
  {
    romaji: 'Monster',
    english: 'Monster',
    native: 'モンスター',
    synopsis: "Un thriller médical européen où sauver une vie déclenche une traque sans fin.",
    score: 91,
    status: 'FINISHED',
    year: 1994,
    chapters: 162,
    volumes: 18,
    tint: '2d2a22',
    genres: ['mystery', 'drama', 'psychological'],
  },
  {
    romaji: '20th Century Boys',
    english: '20th Century Boys',
    native: '20世紀少年',
    synopsis:
      "Des amis d'enfance réalisent qu'un jeu inventé en 1969 sert de plan à une secte apocalyptique.",
    score: 89,
    status: 'FINISHED',
    year: 1999,
    chapters: 249,
    volumes: 24,
    tint: '243040',
    genres: ['mystery', 'drama', 'sci-fi', 'psychological'],
  },
  {
    romaji: 'Oyasumi Punpun',
    english: 'Goodnight Punpun',
    native: 'おやすみプンプン',
    synopsis: "La chronique désarmante d'un garçon dessiné en oiseau qui grandit et se perd.",
    score: 90,
    status: 'FINISHED',
    year: 2007,
    chapters: 147,
    volumes: 13,
    tint: '333333',
    genres: ['drama', 'psychological', 'slice-of-life'],
  },
  {
    romaji: 'Vinland Saga',
    english: 'Vinland Saga',
    native: 'ヴィンランド・サガ',
    synopsis: "Vengeance viking, puis lente tentative de bâtir une terre sans guerre.",
    score: 90,
    status: 'RELEASING',
    year: 2005,
    chapters: 216,
    volumes: 28,
    tint: '243026',
    genres: ['action', 'adventure', 'drama'],
  },
  {
    romaji: 'Hagane no Renkinjutsushi',
    english: 'Fullmetal Alchemist',
    native: '鋼の錬金術師',
    synopsis: "Le manga d'origine : alchimie, transmutation humaine et complot militaire.",
    score: 90,
    status: 'FINISHED',
    year: 2001,
    chapters: 116,
    volumes: 27,
    tint: '2b1a3d',
    genres: ['action', 'adventure', 'drama', 'fantasy'],
  },
  {
    romaji: 'Slam Dunk',
    english: 'Slam Dunk',
    native: 'スラムダンク',
    synopsis: "Un délinquant rejoint le club de basket pour impressionner une fille et y trouve sa vocation.",
    score: 89,
    status: 'FINISHED',
    year: 1990,
    chapters: 276,
    volumes: 31,
    tint: '3a2620',
    genres: ['comedy', 'drama', 'sports'],
  },
  {
    romaji: 'Chainsaw Man',
    english: 'Chainsaw Man',
    native: 'チェンソーマン',
    synopsis: "Un jeune criblé de dettes fusionne avec son démon-tronçonneuse et devient chasseur.",
    score: 87,
    status: 'RELEASING',
    year: 2018,
    chapters: 180,
    volumes: 18,
    tint: '3d2020',
    genres: ['action', 'horror', 'supernatural', 'comedy'],
  },
  {
    romaji: 'Blame!',
    english: 'Blame!',
    native: 'ブラム！',
    synopsis: "Un homme silencieux traverse une mégastructure infinie à la recherche de gènes humains.",
    score: 84,
    status: 'FINISHED',
    year: 1997,
    chapters: 65,
    volumes: 10,
    tint: '222630',
    genres: ['sci-fi', 'action', 'horror'],
  },
  {
    romaji: 'Pluto',
    english: 'Pluto',
    native: 'プルートウ',
    synopsis:
      "Relecture d'Astro Boy en polar : un inspecteur robot enquête sur le meurtre des sept plus puissants.",
    score: 89,
    status: 'FINISHED',
    year: 2003,
    chapters: 65,
    volumes: 8,
    tint: '25303a',
    genres: ['mystery', 'sci-fi', 'drama'],
  },
  {
    romaji: 'Tokyo Ghoul',
    english: 'Tokyo Ghoul',
    native: '東京喰種',
    synopsis: "Un étudiant devient mi-humain mi-goule et doit apprendre à survivre entre deux mondes.",
    score: 81,
    status: 'FINISHED',
    year: 2011,
    chapters: 144,
    volumes: 14,
    tint: '2a2030',
    genres: ['action', 'horror', 'supernatural', 'psychological'],
  },
  {
    romaji: 'Nana',
    english: 'Nana',
    native: 'ナナ',
    synopsis: "Deux jeunes femmes qui portent le même prénom partagent un appartement et des ambitions opposées.",
    score: 86,
    status: 'HIATUS',
    year: 2000,
    chapters: 84,
    volumes: 21,
    tint: '3a2030',
    genres: ['drama', 'romance', 'slice-of-life'],
  },
  {
    romaji: 'Tongari Boushi no Atelier',
    english: 'Witch Hat Atelier',
    native: 'とんがり帽子のアトリエ',
    synopsis: "Une fillette sans don pour la magie entre en apprentissage chez un sorcier discret.",
    score: 88,
    status: 'RELEASING',
    year: 2016,
    chapters: 78,
    volumes: 13,
    tint: '283040',
    genres: ['adventure', 'fantasy', 'drama'],
  },
]

export const mangas: Manga[] = mangaSeeds.map((seed, index) => {
  const id = index + 1
  return {
    '@id': `/api/mangas/${id}`,
    '@type': 'Manga',
    id,
    anilistId: 2000 + id,
    titleRomaji: seed.romaji,
    titleEnglish: seed.english ?? null,
    titleNative: seed.native,
    synopsis: seed.synopsis,
    coverImage: cover(seed.english ?? seed.romaji, seed.tint),
    bannerImage: banner(seed.tint),
    chapterCount: seed.chapters,
    volumeCount: seed.volumes,
    averageScore: seed.score,
    status: seed.status,
    createdAt: iso(2024, 1, 15),
    updatedAt: iso(2024, 6, 1),
    genres: g(...seed.genres),
  }
})
