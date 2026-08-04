/**
 * « Ma liste » de bout en bout, hors réseau réel.
 *
 * Le cache React Query est amorcé avec ce que `/api/progress` renverrait, et
 * `fetch` est remplacé le temps du test : on vérifie donc ce que l'écran
 * affiche **et** ce qu'il envoie, y compris le point le plus délicat — le fait
 * de relire la réponse du serveur au lieu de rejouer ce qu'on croit avoir
 * envoyé, puisque le backend normalise un `COMPLETED` trop bas.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ListPage } from './ListPage'
import { AuthProvider } from '../auth/AuthContext'
import { progressQueryKey, type ProgressEntry } from '../api/progress'
import { setSession } from '../auth/session'
import { fetchCalls, setFetchHandler } from '../test/http'

const USER_IRI = '/api/users/1'

function entry(over: Partial<ProgressEntry> = {}): ProgressEntry {
  return {
    iri: '/api/progress/1',
    id: 1,
    kind: 'anime',
    targetIri: '/api/animes/1',
    targetTitle: 'Cowboy Bebop',
    targetCover: null,
    targetUnitCount: 26,
    status: 'WATCHING',
    currentEpisode: 5,
    currentChapter: null,
    currentChapterRaw: null,
    score: 88,
    updatedAt: '2026-08-01T10:00:00+00:00',
    href: '/anime/1',
    ...over,
  }
}

/** Ce que l'API sert vraiment : JSON-LD, et `currentChapter` en string. */
function progressResource(over: Record<string, unknown> = {}) {
  return {
    '@id': '/api/progress/1',
    '@type': 'Progress',
    id: 1,
    status: 'WATCHING',
    currentEpisode: 6,
    currentChapter: null,
    score: 88,
    updatedAt: '2026-08-02T10:00:00+00:00',
    anime: {
      '@id': '/api/animes/1',
      '@type': 'Anime',
      id: 1,
      titleRomaji: 'Cowboy Bebop',
      episodeCount: 26,
    },
    ...over,
  }
}

function jsonld(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/ld+json' },
  })
}

/**
 * Remplace `fetch` par un serveur minimal mais **cohérent** : le GET de
 * collection resservi après chaque écriture renvoie la même ressource que
 * l'écriture. Sans cela, le `onSettled` de la mutation invaliderait la liste et
 * la repeuplerait avec autre chose — on testerait alors le simulacre.
 */
function mockApi(options: { write?: () => Response; members?: () => unknown[] } = {}) {
  const members = options.members ?? (() => [progressResource()])
  const write = options.write ?? (() => jsonld(progressResource()))

  setFetchHandler((request) => {
    if (request.method === 'GET') {
      return jsonld({
        '@context': '/api/contexts/Progress',
        '@id': '/api/progress',
        '@type': 'Collection',
        totalItems: members().length,
        member: members(),
      })
    }
    return write()
  })
}

/** La première requête d'écriture observée — les GET de rafraîchissement s'intercalent. */
function firstWrite(): Request {
  const call = fetchCalls().find((request) => request.method !== 'GET')
  if (!call) throw new Error('Aucune requête d’écriture observée')
  return call
}

function renderPage(entries: ProgressEntry[], children: ReactNode = <ListPage />) {
  const client = new QueryClient({
    defaultOptions: {
      // `staleTime: Infinity` : la donnée amorcée ne doit pas déclencher de
      // refetch, sinon le test mesurerait le réseau et non l'écran.
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  client.setQueryData(progressQueryKey(USER_IRI), entries)

  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/list']}>
          <AuthProvider>{children}</AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}

/** La ligne portant ce titre, pour ne pas viser un bouton d'une autre ligne. */
function row(title: string): HTMLElement {
  const link = screen.getByRole('link', { name: title })
  const article = link.closest('article')
  if (!article) throw new Error(`Ligne introuvable pour « ${title} »`)
  return article
}

beforeEach(() => {
  setSession({
    token: 'jeton-de-test',
    user: { iri: USER_IRI, id: 1, username: 'testeur', email: 't@example.test', roles: ['ROLE_USER'] },
  })
})

afterEach(() => {
  setSession(null)
})

describe('ListPage — onglets et compteurs', () => {
  it('ouvre sur « en cours », l’onglet qu’on vient consulter', () => {
    renderPage([entry(), entry({ targetIri: '/api/animes/2', status: 'DROPPED' })])

    expect(screen.getByRole('tab', { name: /En cours/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument()
  })

  it('compte chaque onglet, y compris « Tout »', () => {
    renderPage([
      entry({ status: 'WATCHING' }),
      entry({ targetIri: '/api/animes/2', status: 'WATCHING' }),
      entry({ targetIri: '/api/animes/3', status: 'COMPLETED' }),
      entry({ targetIri: '/api/mangas/1', kind: 'manga', status: 'PLANNED' }),
    ])

    expect(within(screen.getByRole('tab', { name: /^Tout/ })).getByText('4')).toBeInTheDocument()
    expect(within(screen.getByRole('tab', { name: /En cours/ })).getByText('2')).toBeInTheDocument()
    expect(within(screen.getByRole('tab', { name: /Terminé/ })).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByRole('tab', { name: /Prévu/ })).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByRole('tab', { name: /Abandonné/ })).getByText('0')).toBeInTheDocument()
  })

  it('change d’onglet sans quitter la page', async () => {
    const user = userEvent.setup()
    renderPage([
      entry({ targetTitle: 'En cours', status: 'WATCHING' }),
      entry({ targetIri: '/api/animes/2', targetTitle: 'Abandonné', status: 'DROPPED' }),
    ])

    expect(screen.queryByRole('link', { name: 'Abandonné' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: /Abandonné/ }))

    expect(screen.getByRole('link', { name: 'Abandonné' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'En cours' })).toBeNull()
  })

  it('propose le catalogue sur un onglet vide', () => {
    renderPage([entry({ status: 'COMPLETED' })])

    expect(screen.getByText(/Aucun titre en cours/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Parcourir le catalogue/ })).toHaveAttribute(
      'href',
      '/',
    )
  })
})

describe('ListPage — séparation anime / manga', () => {
  it('sépare les deux types sous l’onglet « Tout »', async () => {
    const user = userEvent.setup()
    renderPage([
      entry({ targetTitle: 'Un anime' }),
      entry({
        targetIri: '/api/mangas/1',
        kind: 'manga',
        targetTitle: 'Un manga',
        currentEpisode: null,
        currentChapter: 12.5,
        currentChapterRaw: '12.50',
        targetUnitCount: 100,
        href: '/manga/1',
      }),
    ])

    await user.click(screen.getByRole('tab', { name: /^Tout/ }))

    expect(screen.getByRole('heading', { name: /Animes/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Mangas/ })).toBeInTheDocument()
  })

  it('affiche un chapitre décimal sans l’arrondir', async () => {
    const user = userEvent.setup()
    renderPage([
      entry({
        targetIri: '/api/mangas/1',
        kind: 'manga',
        targetTitle: 'Berserk',
        currentEpisode: null,
        // Ce que `parseDecimal("12.50")` produit.
        currentChapter: 12.5,
        currentChapterRaw: '12.50',
        targetUnitCount: 100,
        href: '/manga/1',
      }),
    ])
    await user.click(screen.getByRole('tab', { name: /^Tout/ }))

    expect(within(row('Berserk')).getByText('12.5')).toBeInTheDocument()
  })
})

describe('ListPage — tri', () => {
  it('trie par titre à la demande', async () => {
    const user = userEvent.setup()
    renderPage([
      entry({ targetTitle: 'Zeta', updatedAt: '2026-08-03T10:00:00+00:00' }),
      entry({
        targetIri: '/api/animes/2',
        targetTitle: 'Alpha',
        updatedAt: '2026-08-01T10:00:00+00:00',
      }),
    ])

    // Par défaut : dernière mise à jour, donc Zeta en premier.
    const before = screen.getAllByRole('link', { name: /Zeta|Alpha/ })
    expect(before[0]).toHaveTextContent('Zeta')

    await user.selectOptions(screen.getByLabelText('Trier par'), 'title')

    const after = screen.getAllByRole('link', { name: /Zeta|Alpha/ })
    expect(after[0]).toHaveTextContent('Alpha')
  })

  it('relègue les titres non notés en fin de tri par note', async () => {
    const user = userEvent.setup()
    renderPage([
      entry({ targetTitle: 'Sans note', score: null }),
      entry({ targetIri: '/api/animes/2', targetTitle: 'Notée', score: 70 }),
    ])

    await user.selectOptions(screen.getByLabelText('Trier par'), 'score')

    const rows = screen.getAllByRole('link', { name: /Sans note|Notée/ })
    // Une note absente n'est pas une note de 0 : elle ne doit pas passer devant.
    expect(rows[0]).toHaveTextContent('Notée')
  })
})

describe('ListPage — le bouton « +1 »', () => {
  it('envoie un PATCH qui avance d’un épisode', async () => {
    const user = userEvent.setup()
    mockApi()

    renderPage([entry({ currentEpisode: 5 })])
    await user.click(within(row('Cowboy Bebop')).getByRole('button', { name: /\+1/ }))

    await waitFor(() => expect(fetchCalls().length).toBeGreaterThan(0))

    const request = firstWrite()
    expect(request.method).toBe('PATCH')
    expect(request.url).toContain('/api/progress/1')
    expect(request.headers.get('Content-Type')).toBe('application/merge-patch+json')
    expect(await request.clone().json()).toMatchObject({
      status: 'WATCHING',
      currentEpisode: 6,
      // `currentChapter` sur un anime vaut 422 côté API.
      currentChapter: null,
    })
  })

  it('affiche tout de suite la valeur renvoyée par le serveur', async () => {
    const user = userEvent.setup()
    const saved = progressResource({ currentEpisode: 6 })
    mockApi({ write: () => jsonld(saved), members: () => [saved] })

    renderPage([entry({ currentEpisode: 5 })])
    expect(within(row('Cowboy Bebop')).getByText('5')).toBeInTheDocument()

    await user.click(within(row('Cowboy Bebop')).getByRole('button', { name: /\+1/ }))

    await waitFor(() => expect(within(row('Cowboy Bebop')).getByText('6')).toBeInTheDocument())
  })

  it('propose « terminé » — sans l’imposer — en atteignant le total', async () => {
    const user = userEvent.setup()
    // Le serveur confirme 26/26 mais laisse le statut à WATCHING : c'est cette
    // réponse-là, et non notre calcul, qui déclenche la proposition.
    const saved = progressResource({ currentEpisode: 26, status: 'WATCHING' })
    mockApi({ write: () => jsonld(saved), members: () => [saved] })

    renderPage([entry({ currentEpisode: 25 })])
    await user.click(within(row('Cowboy Bebop')).getByRole('button', { name: /\+1/ }))

    expect(await screen.findByRole('status')).toHaveTextContent(/Marquer comme terminé/)
  })

  it('ne propose rien quand le serveur a déjà marqué le titre terminé', async () => {
    const user = userEvent.setup()
    // Cas où le backend décide seul : il renvoie COMPLETED, il n'y a plus rien
    // à proposer — et la ligne doit changer d'onglet.
    const saved = progressResource({ currentEpisode: 26, status: 'COMPLETED' })
    mockApi({ write: () => jsonld(saved), members: () => [saved] })

    renderPage([entry({ currentEpisode: 25 })])
    await user.click(within(row('Cowboy Bebop')).getByRole('button', { name: /\+1/ }))

    // Le statut renvoyé fait sortir la ligne de l'onglet « en cours »…
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Cowboy Bebop' })).toBeNull(),
    )
    // …et la fait compter dans « terminé ».
    expect(within(screen.getByRole('tab', { name: /Terminé/ })).getByText('1')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('désactive « +1 » au dernier épisode connu — l’API répondrait 422', () => {
    renderPage([entry({ currentEpisode: 26 })])

    expect(within(row('Cowboy Bebop')).getByRole('button', { name: /\+1/ })).toBeDisabled()
  })

  it('reste actif quand le total est inconnu', () => {
    // One Piece n'a aucun `episodeCount` chez AniList : rien ne doit être borné.
    renderPage([entry({ targetTitle: 'One Piece', currentEpisode: 1147, targetUnitCount: null })])

    const line = row('One Piece')
    expect(within(line).getByRole('button', { name: /\+1/ })).toBeEnabled()
    expect(within(line).getByText('total inconnu')).toBeInTheDocument()
  })

  it('remet la ligne dans son état d’origine si le serveur refuse', async () => {
    const user = userEvent.setup()
    mockApi({
      write: () =>
        new Response(JSON.stringify({ detail: 'Progression incohérente.' }), {
          status: 422,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
      // Le serveur n'a rien enregistré : la collection reste à 5.
      members: () => [progressResource({ currentEpisode: 5 })],
    })

    renderPage([entry({ currentEpisode: 5 })])
    await user.click(within(row('Cowboy Bebop')).getByRole('button', { name: /\+1/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Progression incohérente.')
    expect(within(row('Cowboy Bebop')).getByText('5')).toBeInTheDocument()
  })
})

describe('ListPage — édition rapide du statut', () => {
  it('porte le compteur au total en passant à « terminé »', async () => {
    const user = userEvent.setup()
    const saved = progressResource({ currentEpisode: 26, status: 'COMPLETED' })
    mockApi({ write: () => jsonld(saved), members: () => [saved] })

    renderPage([entry({ currentEpisode: 3 })])
    await user.selectOptions(within(row('Cowboy Bebop')).getByLabelText(/Statut de/), 'COMPLETED')

    await waitFor(() => expect(fetchCalls().length).toBeGreaterThan(0))
    expect(await firstWrite().clone().json()).toMatchObject({
      status: 'COMPLETED',
      // Miroir de la normalisation serveur : afficher « Terminé, 3/26 » serait
      // mentir sur ce qui va être enregistré.
      currentEpisode: 26,
    })
  })
})
