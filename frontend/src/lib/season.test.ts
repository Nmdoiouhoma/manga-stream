import { describe, expect, it } from 'vitest'
import {
  currentSeason,
  parseSeasonSlot,
  seasonOfMonth,
  seasonTitle,
  shiftSeason,
} from './season'

describe('seasonOfMonth', () => {
  it('découpe l’année en quatre cours, janvier / avril / juillet / octobre', () => {
    expect([1, 2, 3].map(seasonOfMonth)).toEqual(['WINTER', 'WINTER', 'WINTER'])
    expect([4, 5, 6].map(seasonOfMonth)).toEqual(['SPRING', 'SPRING', 'SPRING'])
    expect([7, 8, 9].map(seasonOfMonth)).toEqual(['SUMMER', 'SUMMER', 'SUMMER'])
    expect([10, 11, 12].map(seasonOfMonth)).toEqual(['FALL', 'FALL', 'FALL'])
  })

  it('borne les mois aberrants au lieu de renvoyer undefined', () => {
    expect(seasonOfMonth(0)).toBe('WINTER')
    expect(seasonOfMonth(13)).toBe('FALL')
  })
})

describe('currentSeason', () => {
  it('lit la saison de la date fournie', () => {
    expect(currentSeason(new Date('2026-08-05T12:00:00Z'))).toEqual({
      season: 'SUMMER',
      year: 2026,
    })
    expect(currentSeason(new Date('2026-01-01T12:00:00Z'))).toEqual({
      season: 'WINTER',
      year: 2026,
    })
  })
})

describe('shiftSeason', () => {
  it('avance et recule sans franchir l’année à tort', () => {
    expect(shiftSeason({ season: 'SUMMER', year: 2026 }, 1)).toEqual({
      season: 'FALL',
      year: 2026,
    })
    expect(shiftSeason({ season: 'SUMMER', year: 2026 }, -1)).toEqual({
      season: 'SPRING',
      year: 2026,
    })
  })

  it('franchit l’année dans les deux sens', () => {
    expect(shiftSeason({ season: 'FALL', year: 2026 }, 1)).toEqual({
      season: 'WINTER',
      year: 2027,
    })
    expect(shiftSeason({ season: 'WINTER', year: 2026 }, -1)).toEqual({
      season: 'FALL',
      year: 2025,
    })
  })

  it('encaisse un décalage de plusieurs années', () => {
    expect(shiftSeason({ season: 'SPRING', year: 2026 }, 9)).toEqual({
      season: 'SUMMER',
      year: 2028,
    })
    expect(shiftSeason({ season: 'SPRING', year: 2026 }, -9)).toEqual({
      season: 'WINTER',
      year: 2024,
    })
  })

  it('revient au point de départ en faisant le tour', () => {
    const slot = { season: 'FALL', year: 2026 } as const
    expect(shiftSeason(slot, 4)).toEqual({ season: 'FALL', year: 2027 })
    expect(shiftSeason(shiftSeason(slot, 3), -3)).toEqual(slot)
  })
})

describe('seasonTitle', () => {
  it('rend un libellé lisible en français', () => {
    expect(seasonTitle({ season: 'SUMMER', year: 2026 })).toBe('Été 2026')
    expect(seasonTitle({ season: 'WINTER', year: 2027 })).toBe('Hiver 2027')
  })
})

describe('parseSeasonSlot', () => {
  const fallback = { season: 'SUMMER', year: 2026 } as const

  it('accepte une saison et une année valides', () => {
    expect(parseSeasonSlot('FALL', '2024', fallback)).toEqual({ season: 'FALL', year: 2024 })
  })

  it('retombe sur la saison en cours dès que la valeur est douteuse', () => {
    expect(parseSeasonSlot(null, null, fallback)).toEqual(fallback)
    expect(parseSeasonSlot('AUTOMNE', '2024', fallback)).toEqual({
      season: 'SUMMER',
      year: 2024,
    })
    expect(parseSeasonSlot('FALL', 'bientôt', fallback)).toEqual({
      season: 'FALL',
      year: 2026,
    })
    expect(parseSeasonSlot('FALL', '1200', fallback)).toEqual({ season: 'FALL', year: 2026 })
  })
})
