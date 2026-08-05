import { describe, expect, it } from 'vitest'
import { avatarColors, hueOf, initialsOf } from './avatar'

describe('initialsOf', () => {
  it('prend les deux premières lettres d’un pseudo simple', () => {
    expect(initialsOf('nakib')).toBe('NA')
    expect(initialsOf('bob')).toBe('BO')
  })

  it('prend l’initiale de chaque mot quand il y en a plusieurs', () => {
    expect(initialsOf('jean dupont')).toBe('JD')
    expect(initialsOf('marie-claire')).toBe('MC')
    expect(initialsOf('user_name')).toBe('UN')
    expect(initialsOf('a.b.c')).toBe('AB')
  })

  it('n’est pas dérouté par une lettre seule', () => {
    expect(initialsOf('x')).toBe('X')
  })

  it('rend un repère plutôt que rien quand le pseudo est vide', () => {
    expect(initialsOf('')).toBe('?')
    expect(initialsOf('   ')).toBe('?')
  })

  /**
   * Le point de ce test : `slice(0, 2)` couperait un emoji en deux moitiés
   * d'unité de code et afficherait un losange de remplacement.
   */
  it('ne coupe pas un caractère en deux', () => {
    expect(Array.from(initialsOf('🐙poulpe'))).toHaveLength(2)
    expect(initialsOf('émile')).toBe('ÉM')
  })
})

describe('hueOf', () => {
  it('rend toujours la même teinte pour le même pseudo', () => {
    expect(hueOf('nakib')).toBe(hueOf('nakib'))
  })

  it('ignore la casse et les espaces autour', () => {
    expect(hueOf('  Nakib  ')).toBe(hueOf('nakib'))
  })

  it('reste dans les bornes d’une teinte HSL', () => {
    for (const name of ['a', 'nakib', 'très long pseudonyme avec des accents', '🐙']) {
      const hue = hueOf(name)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  /**
   * L'intérêt d'un vrai hachage plutôt que du code du premier caractère :
   * deux comptes voisins ne doivent pas se ressembler à l'écran.
   */
  it('éloigne les pseudos qui ne diffèrent que d’un caractère', () => {
    const distance = (a: string, b: string) => {
      const raw = Math.abs(hueOf(a) - hueOf(b))
      return Math.min(raw, 360 - raw)
    }

    expect(distance('nakib', 'nakib2')).toBeGreaterThan(20)
    expect(distance('alice', 'alicf')).toBeGreaterThan(20)
  })

  it('distribue largement un lot de pseudos réalistes', () => {
    const names = ['nakib', 'alice', 'bob', 'charlie', 'dora', 'emile', 'fanny', 'gaspard']
    const hues = new Set(names.map(hueOf))

    expect(hues.size).toBe(names.length)
  })
})

describe('avatarColors', () => {
  it('ne fait varier que la teinte', () => {
    const one = avatarColors('alice')
    const two = avatarColors('bob')

    expect(one.background).not.toBe(two.background)
    // Saturation et luminosité identiques : c'est ce qui tient le contraste.
    expect(one.background.replace(/^hsl\(\d+/, '')).toBe(two.background.replace(/^hsl\(\d+/, ''))
  })

  it('est stable d’un appel à l’autre', () => {
    expect(avatarColors('nakib')).toEqual(avatarColors('nakib'))
  })
})
