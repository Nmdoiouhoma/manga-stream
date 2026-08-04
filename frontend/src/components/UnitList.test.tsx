/**
 * Rendu de la liste des épisodes sur les données réellement en base.
 *
 * Le cas majoritaire n'est pas l'épisode complet : sur les 4 392 épisodes
 * importés, **59 % n'ont qu'un numéro** — pas de titre, pas de vignette, pas de
 * date — et seuls 1 795 portent un `streamUrl`. Une ligne dégradée est donc la
 * norme, pas l'exception, et c'est elle qu'on ancre ici :
 *
 *  - sans titre    → « Épisode 12 », construit du numéro, jamais un vide ;
 *  - sans vignette → une pastille typographique, jamais un `<img>` cassé ;
 *  - sans lien     → **rien du tout**, jamais un bouton grisé : la donnée est
 *                    absente chez AniList, ce n'est pas une panne ;
 *  - sans durée ni date → pas de « · » orphelin en tête de ligne.
 */
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UnitList } from './UnitList'
import { AuthProvider } from '../auth/AuthContext'
import type { Episode, MediaDetail } from '../types/media'

function Providers({ children }: { children: ReactNode }) {
  // `retry: false` : un test ne doit jamais attendre une seconde tentative.
  // Anonyme de toute façon, donc `useProgressList` reste désactivé et aucune
  // requête ne part.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  )
}

function episode(number: number, over: Partial<Episode> = {}): Episode {
  return {
    '@id': `/api/episodes/${number}`,
    '@type': 'Episode',
    id: number,
    number,
    ...over,
  }
}

function anime(episodes: Episode[], unitCount: number | null = null): MediaDetail {
  return {
    key: 'anime-/api/animes/1',
    iri: '/api/animes/1',
    id: 1,
    kind: 'anime',
    title: 'Titre',
    subtitle: null,
    synopsis: '',
    coverImage: null,
    averageScore: null,
    status: null,
    releaseLabel: null,
    genres: [],
    countLabel: null,
    href: '/anime/1',
    titleRomaji: 'Titre',
    titleEnglish: null,
    titleNative: null,
    bannerImage: null,
    startDate: null,
    endDate: null,
    episodes,
    chapters: [],
    unitCount,
    volumeCount: null,
  }
}

function renderList(media: MediaDetail) {
  return render(
    <Providers>
      <UnitList media={media} />
    </Providers>,
  )
}

describe('UnitList — épisode sans titre et sans lien', () => {
  it('titre l’épisode par son numéro quand le champ est absent', () => {
    renderList(anime([episode(12)]))

    expect(screen.getByText('Épisode 12')).toBeInTheDocument()
  })

  it('traite un titre vide ou fait d’espaces comme un titre absent', () => {
    renderList(anime([episode(12, { title: '   ' })]))

    expect(screen.getByText('Épisode 12')).toBeInTheDocument()
  })

  it('n’affiche aucun lien sortant quand streamUrl manque', () => {
    renderList(anime([episode(12)]))

    // Pas de bouton grisé non plus : rien.
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/Regarder/)).toBeNull()
  })

  it('rejette une URL non http(s) comme une URL absente', () => {
    // Les `streamUrl` viennent de l'import AniList : un `javascript:` recopié
    // dans un href s'exécuterait dans notre origine.
    renderList(anime([episode(12, { streamUrl: 'javascript:alert(1)' })]))

    expect(screen.queryByRole('link')).toBeNull()
  })

  it('affiche le lien, nommé, quand streamUrl est exploitable', () => {
    renderList(anime([episode(12, { streamUrl: 'http://www.crunchyroll.com/e/12' })]))

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
    // Passage en https : AniList sert ces liens en clair, et le titre regardé
    // partirait sinon en clair depuis une page https.
    expect(link).toHaveAttribute('href', 'https://www.crunchyroll.com/e/12')
    expect(link).toHaveAccessibleName(/Regarder l’épisode 12 sur Crunchyroll/)
  })

  it('remplace la vignette manquante par une pastille, pas par une image cassée', () => {
    const { container } = renderList(anime([episode(12)]))

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.unit__thumb-fallback')?.textContent).toBe('12')
  })

  it('n’affiche pas de séparateur orphelin quand durée et date manquent', () => {
    const { container } = renderList(anime([episode(12)]))

    expect(container.querySelector('.unit__meta')).toBeNull()
  })

  it('assemble durée et date quand les deux sont là', () => {
    renderList(anime([episode(12, { duration: 24, airDate: '2023-10-01T00:00:00+00:00' })]))

    expect(screen.getByText(/^24 min · /)).toBeInTheDocument()
  })

  it('n’offre pas de bouton « marquer comme vu » à un visiteur anonyme', () => {
    renderList(anime([episode(12)]))

    expect(screen.queryByRole('button', { name: /Marquer comme vu/ })).toBeNull()
  })

  it('distingue « aucun épisode annoncé » de « annoncés mais pas encore importés »', () => {
    const { unmount } = renderList(anime([], null))
    expect(screen.getByText(/Aucun épisode référencé/)).toBeInTheDocument()
    unmount()

    renderList(anime([], 12))
    expect(screen.getByText(/12 épisodes annoncés/)).toBeInTheDocument()
    expect(screen.getByText(/aucun n’est encore référencé/)).toBeInTheDocument()
  })

  it('rend une liste entière d’épisodes nus sans en perdre un', () => {
    renderList(anime([episode(1), episode(2), episode(3)]))

    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('Épisode 3')).toBeInTheDocument()
  })
})
