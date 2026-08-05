/**
 * Saisons de diffusion : le découpage en « cours » japonais, et rien de plus.
 *
 * Sans React, sans appel réseau — la même raison que `progression.ts` : c'est
 * de l'arithmétique de calendrier, elle se teste directement.
 *
 * ── Le découpage, vérifié sur les données ─────────────────────────────────
 * Janvier, avril, juillet, octobre. Ce n'est pas la définition d'AniList
 * (qui fait commencer l'hiver en décembre), c'est ce que ses données
 * contiennent réellement — relevé sur le catalogue importé :
 *
 *     WINTER → janvier 214, février 23, mars 12, décembre 6
 *     SPRING → avril 289, mars 8, mai 7, juin 11
 *     SUMMER → juillet 251, août 23, septembre 18, juin 12
 *     FALL   → octobre 272, novembre 12, décembre 22, septembre 11
 *
 * Le mois de démarrage dominant est sans ambiguïté à chaque fois. Les quelques
 * décembres classés en hiver sont des séries qui prennent l'avance sur le cours
 * de janvier — leur `seasonYear` est alors l'année suivante, et c'est déjà lui
 * qui fait foi ici : on ne recalcule jamais la saison d'une œuvre, on lit celle
 * que le backend a importée. Ce module ne sert qu'à savoir *quelle saison
 * afficher*.
 */
import { SEASON_LABELS, type MediaSeason } from '../types/media'

/** Dans l'ordre de diffusion, ce qui donne le sens de « précédent/suivant ». */
export const SEASONS: readonly MediaSeason[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL']

export type SeasonSlot = {
  season: MediaSeason
  year: number
}

/** La saison d'un mois civil (1 = janvier). */
export function seasonOfMonth(month: number): MediaSeason {
  // 1-3 → 0, 4-6 → 1, 7-9 → 2, 10-12 → 3.
  const index = Math.floor((Math.min(12, Math.max(1, month)) - 1) / 3)

  return SEASONS[index]
}

/**
 * La saison en cours.
 *
 * La date est un paramètre, jamais un `new Date()` caché : un module qui lit
 * l'horloge lui-même n'est testable qu'en gelant le temps.
 */
export function currentSeason(now: Date): SeasonSlot {
  return { season: seasonOfMonth(now.getMonth() + 1), year: now.getFullYear() }
}

/**
 * Décale de `delta` saisons, en franchissant les années.
 *
 * `shiftSeason({ season: 'FALL', year: 2026 }, 1)` → hiver 2027.
 */
export function shiftSeason(slot: SeasonSlot, delta: number): SeasonSlot {
  const absolute = slot.year * 4 + SEASONS.indexOf(slot.season) + delta

  // `Math.floor` et non une division entière : l'un et l'autre diffèrent sur
  // les négatifs, et une année négative n'a aucune raison de casser le calcul.
  return {
    season: SEASONS[((absolute % 4) + 4) % 4],
    year: Math.floor(absolute / 4),
  }
}

/** « Été 2026 ». */
export function seasonTitle(slot: SeasonSlot): string {
  return `${SEASON_LABELS[slot.season]} ${slot.year}`
}

/**
 * Lit une saison depuis l'URL, en retombant sur `fallback` à la moindre valeur
 * douteuse — une querystring est saisie à la main aussi souvent qu'elle est
 * cliquée.
 */
export function parseSeasonSlot(
  season: string | null,
  year: string | null,
  fallback: SeasonSlot,
): SeasonSlot {
  const parsedYear = Number.parseInt(year ?? '', 10)

  return {
    season: SEASONS.find((candidate) => candidate === season) ?? fallback.season,
    // Bornes larges, alignées sur la validation du backend (1900-2200) : le but
    // est d'écarter l'absurde, pas de deviner ce qui est plausible.
    year: Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 2200
      ? parsedYear
      : fallback.year,
  }
}
