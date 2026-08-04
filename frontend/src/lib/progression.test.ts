/**
 * Les règles de progression sont l'endroit où le front peut le plus facilement
 * fabriquer une requête que l'API refusera (422 `CoherentProgress`) ou afficher
 * un état que le serveur va corriger dans son dos (normalisation `COMPLETED`).
 *
 * Trois familles de cas sont ancrées ici :
 *  - la **normalisation `COMPLETED`**, miroir de `ProgressCompletionProvider` ;
 *  - le **total inconnu** (`episodeCount` null : AniList ne le remplit pas sur
 *    les séries en cours — One Piece n'en a aucun), où l'on ne doit ni borner
 *    ni deviner ;
 *  - les **décimaux sérialisés en string** (`decimal(8,2)`, "12.50"), qui ne
 *    doivent ni être arrondis à la lecture ni repartir en nombre.
 */
import { describe, expect, it } from 'vitest'
import {
  advance,
  currentUnitOf,
  hasTotal,
  markUpToInput,
  normalizeCompletion,
  progressRatio,
  statusChangeInput,
  type ProgressTarget,
} from './progression'
import type { ProgressEntry, ProgressStatus } from '../api/progress'
import { formatChapterNumber, parseDecimal, toDecimalString } from '../types/media'

const ANIME: ProgressTarget = { targetIri: '/api/animes/1', kind: 'anime', total: 25 }
const ANIME_SANS_TOTAL: ProgressTarget = { targetIri: '/api/animes/2', kind: 'anime', total: null }
const MANGA: ProgressTarget = { targetIri: '/api/mangas/1', kind: 'manga', total: 100 }

function entry(over: Partial<ProgressEntry> = {}): ProgressEntry {
  return {
    iri: '/api/progress/1',
    id: 1,
    kind: 'anime',
    targetIri: '/api/animes/1',
    targetTitle: 'Titre',
    targetCover: null,
    targetUnitCount: 25,
    status: 'WATCHING',
    currentEpisode: 5,
    currentChapter: null,
    currentChapterRaw: null,
    score: 80,
    updatedAt: '2026-08-01T10:00:00+00:00',
    href: '/anime/1',
    ...over,
  }
}

describe('hasTotal', () => {
  it('rejette null, mais aussi 0 — une donnée d’import dégradée, pas une œuvre vide', () => {
    expect(hasTotal(25)).toBe(true)
    expect(hasTotal(null)).toBe(false)
    expect(hasTotal(0)).toBe(false)
    expect(hasTotal(Number.NaN)).toBe(false)
  })
})

describe('currentUnitOf', () => {
  it('lit le compteur du bon type de média', () => {
    expect(currentUnitOf(entry({ kind: 'anime', currentEpisode: 12 }))).toBe(12)
    expect(
      currentUnitOf(entry({ kind: 'manga', currentEpisode: null, currentChapter: 12.5 })),
    ).toBe(12.5)
  })

  it('distingue « non suivi » (null) de « au tout début » (0)', () => {
    expect(currentUnitOf(null)).toBeNull()
    expect(currentUnitOf(entry({ currentEpisode: null }))).toBeNull()
    expect(currentUnitOf(entry({ currentEpisode: 0 }))).toBe(0)
  })
})

describe('normalizeCompletion', () => {
  it('porte au total un COMPLETED dont le compteur est trop bas', () => {
    // Ce que fait `App\State\ProgressCompletionProvider` : il normalise, il ne
    // rejette pas. Afficher 1/25 « Terminé » serait mentir sur l'enregistré.
    expect(normalizeCompletion('COMPLETED', 1, 25)).toBe(25)
    expect(normalizeCompletion('COMPLETED', null, 25)).toBe(25)
  })

  it('ne touche pas à un COMPLETED déjà au total', () => {
    expect(normalizeCompletion('COMPLETED', 25, 25)).toBe(25)
  })

  it('ne normalise rien quand le total est inconnu', () => {
    expect(normalizeCompletion('COMPLETED', 12, null)).toBe(12)
    expect(normalizeCompletion('COMPLETED', null, null)).toBeNull()
    expect(normalizeCompletion('COMPLETED', 12, 0)).toBe(12)
  })

  it('laisse les autres statuts intacts', () => {
    const others: ProgressStatus[] = ['WATCHING', 'PLANNED', 'PAUSED', 'DROPPED']
    for (const status of others) {
      expect(normalizeCompletion(status, 3, 25)).toBe(3)
    }
  })
})

describe('progressRatio', () => {
  it('ne dessine pas de barre sans échelle', () => {
    expect(progressRatio(12, null)).toBeNull()
    expect(progressRatio(12, 0)).toBeNull()
  })

  it('borne entre 0 et 1, y compris sur une donnée incohérente', () => {
    expect(progressRatio(0, 25)).toBe(0)
    expect(progressRatio(null, 25)).toBe(0)
    expect(progressRatio(25, 25)).toBe(1)
    expect(progressRatio(40, 25)).toBe(1)
    expect(progressRatio(-3, 25)).toBe(0)
  })
})

describe('advance — le geste « +1 »', () => {
  it('avance d’un épisode et vise le bon champ du contrat', () => {
    const result = advance(ANIME, entry({ currentEpisode: 5 }))

    expect(result?.unit).toBe(6)
    expect(result?.input.currentEpisode).toBe(6)
    // `currentChapter` sur un anime vaut 422 côté API.
    expect(result?.input.currentChapter).toBeNull()
  })

  it('démarre à 1 sur un titre jamais suivi, et le passe en « en cours »', () => {
    const result = advance(ANIME, null)

    expect(result?.unit).toBe(1)
    expect(result?.status).toBe('WATCHING')
    expect(result?.input.existing).toBeNull()
  })

  it('promeut « prévu » en « en cours », mais respecte « en pause » et « abandonné »', () => {
    expect(advance(ANIME, entry({ status: 'PLANNED' }))?.status).toBe('WATCHING')
    // Avancer d'un épisode ne veut pas dire « j'ai repris » : la ligne doit
    // rester dans l'onglet où l'utilisateur l'a rangée.
    expect(advance(ANIME, entry({ status: 'PAUSED' }))?.status).toBe('PAUSED')
    expect(advance(ANIME, entry({ status: 'DROPPED' }))?.status).toBe('DROPPED')
  })

  it('propose « terminé » en atteignant le total, sans l’imposer', () => {
    const result = advance(ANIME, entry({ currentEpisode: 24 }))

    expect(result?.unit).toBe(25)
    expect(result?.reachesTotal).toBe(true)
    expect(result?.suggestsCompletion).toBe(true)
    // Une proposition, pas une décision : abandonner une série à son dernier
    // épisode est un cas réel.
    expect(result?.status).toBe('WATCHING')
  })

  it('ne propose plus rien quand le titre est déjà marqué terminé', () => {
    const result = advance(ANIME, entry({ currentEpisode: 24, status: 'COMPLETED' }))
    expect(result?.suggestsCompletion).toBe(false)
  })

  it('refuse d’aller au-delà du total — l’API répondrait 422', () => {
    expect(advance(ANIME, entry({ currentEpisode: 25 }))).toBeNull()
    expect(advance(ANIME, entry({ currentEpisode: 30 }))).toBeNull()
  })

  it('n’impose aucune borne quand le total est inconnu', () => {
    const result = advance(ANIME_SANS_TOTAL, entry({ currentEpisode: 1147 }))

    expect(result?.unit).toBe(1148)
    expect(result?.reachesTotal).toBe(false)
    expect(result?.suggestsCompletion).toBe(false)
  })

  it('repart de la partie entière sur un chapitre bis : après 12,5 vient le 13', () => {
    const manga = entry({
      kind: 'manga',
      currentEpisode: null,
      // Ce que l'API sert réellement, et ce que `parseDecimal` en fait.
      currentChapter: parseDecimal('12.50'),
      currentChapterRaw: '12.50',
      targetUnitCount: 100,
    })

    const result = advance(MANGA, manga)

    expect(result?.unit).toBe(13)
    expect(result?.input.currentChapter).toBe(13)
    expect(result?.input.currentEpisode).toBeNull()
    // Ce qui repart sur le réseau reste une chaîne décimale.
    expect(toDecimalString(result?.input.currentChapter ?? null)).toBe('13.00')
  })

  it('conserve la note personnelle : « +1 » ne parle que de progression', () => {
    expect(advance(ANIME, entry({ score: 92 }))?.input.score).toBe(92)
  })
})

describe('statusChangeInput — édition rapide depuis une ligne', () => {
  it('porte le compteur au total en passant à « terminé »', () => {
    const input = statusChangeInput(ANIME, entry({ currentEpisode: 3 }), 'COMPLETED')

    expect(input.status).toBe('COMPLETED')
    expect(input.currentEpisode).toBe(25)
  })

  it('laisse le compteur tel quel quand le total est inconnu', () => {
    const input = statusChangeInput(
      ANIME_SANS_TOTAL,
      entry({ currentEpisode: 3, targetUnitCount: null }),
      'COMPLETED',
    )

    expect(input.currentEpisode).toBe(3)
  })

  it('ne redescend rien en quittant « terminé » : avoir tout vu reste vrai', () => {
    const input = statusChangeInput(ANIME, entry({ currentEpisode: 25, status: 'COMPLETED' }), 'DROPPED')

    expect(input.status).toBe('DROPPED')
    expect(input.currentEpisode).toBe(25)
  })

  it('sérialise un total de chapitres sur le champ manga', () => {
    const manga = entry({
      kind: 'manga',
      currentEpisode: null,
      currentChapter: 12.5,
      targetUnitCount: 100,
    })
    const input = statusChangeInput(MANGA, manga, 'COMPLETED')

    expect(input.currentChapter).toBe(100)
    expect(input.currentEpisode).toBeNull()
  })
})

describe('markUpToInput — clic « vu » dans la liste des épisodes', () => {
  it('marque jusqu’à l’épisode visé', () => {
    const input = markUpToInput(ANIME, entry({ currentEpisode: 2 }), 12, false)

    expect(input.currentEpisode).toBe(12)
    expect(input.status).toBe('WATCHING')
  })

  it('pose « terminé » quand le dernier épisode connu est coché', () => {
    const input = markUpToInput(ANIME, entry({ currentEpisode: 24 }), 25, false)
    expect(input.status).toBe('COMPLETED')
  })

  it('ne devine pas « terminé » sans total fiable', () => {
    const input = markUpToInput(ANIME_SANS_TOTAL, entry({ currentEpisode: 1146 }), 1147, false)
    expect(input.status).toBe('WATCHING')
  })

  it('décocher ramène juste avant, sans repartir de zéro', () => {
    const input = markUpToInput(ANIME, entry({ currentEpisode: 12 }), 12, true)
    expect(input.currentEpisode).toBe(11)
  })

  it('décocher le tout premier épisode donne 0, pas null', () => {
    // `null` voudrait dire « non renseigné », ce qui n'est pas la même chose.
    const input = markUpToInput(ANIME, entry({ currentEpisode: 1 }), 1, true)
    expect(input.currentEpisode).toBe(0)
  })

  it('fait redescendre un titre « terminé » en « en cours » quand on recule', () => {
    // Sans cela, le couple (COMPLETED, 24/25) part en 422 sur un simple
    // décochage depuis que le backend valide la cohérence.
    const input = markUpToInput(ANIME, entry({ currentEpisode: 25, status: 'COMPLETED' }), 25, true)

    expect(input.currentEpisode).toBe(24)
    expect(input.status).toBe('WATCHING')
  })
})

describe('décimaux sérialisés en string', () => {
  it('lit "12.50" sans l’arrondir et le réaffiche en "12.5"', () => {
    expect(parseDecimal('12.50')).toBe(12.5)
    expect(formatChapterNumber('12.50')).toBe('12.5')
    expect(formatChapterNumber('12.00')).toBe('12')
  })

  it('tolère la virgule décimale et retombe sur la valeur par défaut sur une saisie invalide', () => {
    expect(parseDecimal('12,5')).toBe(12.5)
    expect(parseDecimal('abc', 0)).toBe(0)
    expect(parseDecimal(null)).toBe(0)
  })

  it('renvoie toujours deux décimales à l’écriture, et null pour « non renseigné »', () => {
    expect(toDecimalString(13)).toBe('13.00')
    expect(toDecimalString(12.5)).toBe('12.50')
    expect(toDecimalString(null)).toBeNull()
    expect(toDecimalString(Number.NaN)).toBeNull()
  })
})
