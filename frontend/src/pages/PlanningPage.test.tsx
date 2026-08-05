/**
 * `/planning` — la saison vient de l'URL, et l'écran regroupe par statut.
 *
 * Ce qui est réellement testé ici, c'est ce que la page décide : quelle saison
 * demander à l'API, et comment répartir ce qu'elle reçoit. Le rendu des cartes
 * appartient à `MediaCard`, déjà couvert ailleurs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PlanningPage } from './PlanningPage'
import { AuthProvider } from '../auth/AuthContext'
import { setSession } from '../auth/session'
import { fetchCalls, setFetchHandler } from '../test/http'

function anime(id: number, title: string, status: string) {
  return {
    '@id': `/api/animes/${id}`,
    '@type': 'Anime',
    id,
    titleRomaji: title,
    titleEnglish: null,
    titleNative: null,
    synopsis: '',
    coverImage: null,
    averageScore: 70,
    status,
    season: 'SUMMER',
    seasonYear: 2026,
    episodes: 12,
    genres: [],
  }
}

function collection(members: unknown[]): Response {
  return new Response(
    JSON.stringify({
      '@context': '/api/contexts/Anime',
      '@id': '/api/animes',
      '@type': 'Collection',
      totalItems: members.length,
      member: members,
    }),
    { status: 200, headers: { 'Content-Type': 'application/ld+json' } },
  )
}

function renderPlanning(url: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <AuthProvider>
          <PlanningPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  setSession(null)
})

afterEach(() => {
  setSession(null)
})

describe('PlanningPage', () => {
  it('demande à l’API la saison lue dans l’URL', async () => {
    setFetchHandler(() => collection([]))
    renderPlanning('/planning?season=FALL&year=2024')

    await waitFor(() => expect(fetchCalls().length).toBeGreaterThan(0))

    const url = new URL(fetchCalls()[0].url)
    expect(url.pathname).toBe('/api/animes')
    expect(url.searchParams.get('season')).toBe('FALL')
    expect(url.searchParams.get('seasonYear')).toBe('2024')
    expect(url.searchParams.get('order[popularity]')).toBe('desc')
  })

  it('affiche le titre de la saison demandée', async () => {
    setFetchHandler(() => collection([]))
    renderPlanning('/planning?season=WINTER&year=2027')

    expect(await screen.findByText(/Planning — Hiver 2027/)).toBeInTheDocument()
  })

  it('sépare ce qui est diffusé de ce qui ne l’est pas encore', async () => {
    setFetchHandler(() =>
      collection([
        anime(1, 'Déjà diffusé', 'RELEASING'),
        anime(2, 'Pas encore sorti', 'NOT_YET_RELEASED'),
        anime(3, 'Fini depuis longtemps', 'FINISHED'),
      ]),
    )
    renderPlanning('/planning?season=SUMMER&year=2026')

    expect(await screen.findByRole('heading', { name: /En diffusion/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /À venir/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Terminés/ })).toBeInTheDocument()
  })

  it('dit clairement quand la saison est vide, au lieu de n’afficher rien', async () => {
    setFetchHandler(() => collection([]))
    renderPlanning('/planning?season=SPRING&year=2019')

    expect(await screen.findByText(/Rien d’importé pour Printemps 2019/)).toBeInTheDocument()
  })
})
