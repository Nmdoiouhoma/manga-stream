/**
 * Publication d'un commentaire (tâche #22).
 *
 * Le symptôme rapporté était qu'un commentaire racine n'apparaissait qu'après
 * rechargement. Ces tests ancrent le correctif là où il compte : le message
 * doit être à l'écran **avant** toute réponse du serveur, et en repartir si le
 * serveur refuse.
 *
 * La requête d'écriture est donc volontairement laissée **en suspens** dans le
 * premier test : si l'affichage dépendait encore d'un rafraîchissement, rien
 * n'apparaîtrait.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommentThread } from './CommentThread'
import { AuthProvider } from '../auth/AuthContext'
import { commentsQueryKey, type CommentNode } from '../api/comments'
import { setSession } from '../auth/session'
import { setFetchHandler } from '../test/http'

const USER_IRI = '/api/users/1'
const TARGET_IRI = '/api/animes/1'

function node(over: Partial<CommentNode> = {}): CommentNode {
  return {
    iri: '/api/comments/1',
    id: 1,
    content: 'Un commentaire déjà là',
    authorIri: '/api/users/2',
    authorName: 'quelqun',
    createdAt: '2026-08-01T10:00:00+00:00',
    parentIri: null,
    replies: [],
    ...over,
  }
}

function jsonld(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/ld+json' },
  })
}

/** Collection vide : le fil visible vient du cache amorcé, pas du réseau. */
function emptyCollection(): Response {
  return jsonld({
    '@context': '/api/contexts/Comment',
    '@id': '/api/comments',
    '@type': 'Collection',
    totalItems: 0,
    member: [],
  })
}

function renderThread(comments: CommentNode[]) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  client.setQueryData(commentsQueryKey(TARGET_IRI), comments)

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <CommentThread kind="anime" targetIri={TARGET_IRI} />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function publish(text: string) {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText('Votre commentaire…'), text)
  await user.click(screen.getByRole('button', { name: 'Publier' }))
}

beforeEach(() => {
  setSession({
    token: 'jeton-de-test',
    user: {
      iri: USER_IRI,
      id: 1,
      username: 'testeur',
      email: 't@example.test',
      roles: ['ROLE_USER'],
    },
  })
})

afterEach(() => {
  setSession(null)
})

describe('CommentThread — publication', () => {
  it('affiche le commentaire avant même que le serveur ait répondu', async () => {
    // La requête d'écriture ne se résout jamais : seule une mise à jour
    // optimiste peut faire apparaître le texte.
    setFetchHandler((request) => {
      if (request.method === 'GET') return emptyCollection()
      return new Promise<Response>(() => {})
    })

    renderThread([])
    await publish('Mon tout premier commentaire')

    expect(screen.getByText('Mon tout premier commentaire')).toBeInTheDocument()
    // Signalé comme non confirmé, et sans action possible tant qu'il n'a pas
    // d'identifiant serveur.
    expect(screen.getByText('envoi en cours')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull()
  })

  it('met le nouveau fil en tête, comme le fait buildThread', async () => {
    setFetchHandler((request) => {
      if (request.method === 'GET') return emptyCollection()
      return new Promise<Response>(() => {})
    })

    renderThread([node({ content: 'Un ancien commentaire' })])
    await publish('Le tout dernier')

    const bodies = screen
      .getAllByText(/Un ancien commentaire|Le tout dernier/)
      .map((element) => element.textContent)
    expect(bodies[0]).toBe('Le tout dernier')
  })

  it('envoie bien l’œuvre visée, et jamais l’auteur', async () => {
    let written: Request | null = null
    setFetchHandler((request) => {
      if (request.method === 'GET') return emptyCollection()
      written = request
      return jsonld({ '@id': '/api/comments/9', '@type': 'Comment', id: 9, content: 'x' }, 201)
    })

    renderThread([])
    await publish('Contenu')

    await waitFor(() => expect(written).not.toBeNull())
    const body = (await written!.clone().json()) as Record<string, unknown>
    expect(body).toMatchObject({ content: 'Contenu', anime: TARGET_IRI })
    // `user` est assigné depuis le JWT côté serveur : l'envoyer serait au mieux
    // redondant, au pire une façon de contredire le serveur.
    expect(body).not.toHaveProperty('user')
    expect(body).not.toHaveProperty('manga')
  })

  it('retire le commentaire et affiche l’erreur si le serveur refuse', async () => {
    setFetchHandler((request) => {
      if (request.method === 'GET') return emptyCollection()
      return new Response(JSON.stringify({ detail: 'Contenu refusé.' }), {
        status: 422,
        headers: { 'Content-Type': 'application/problem+json' },
      })
    })

    renderThread([])
    await publish('Commentaire voué à l’échec')

    expect(await screen.findByRole('alert')).toHaveTextContent('Contenu refusé.')
    // Rollback : rien ne doit rester à l'écran comme si c'était enregistré.
    await waitFor(() =>
      expect(screen.queryByText('Commentaire voué à l’échec')).toBeNull(),
    )
  })

  it('rattache une réponse sous son commentaire parent', async () => {
    setFetchHandler((request) => {
      if (request.method === 'GET') return emptyCollection()
      return new Promise<Response>(() => {})
    })

    const user = userEvent.setup()
    renderThread([node({ content: 'Le fil' })])

    await user.click(screen.getByRole('button', { name: 'Répondre' }))
    await user.type(screen.getByPlaceholderText(/Répondre à/), 'Ma réponse')
    await user.click(screen.getByRole('button', { name: 'Répondre' }))

    // La réponse vit dans la liste imbriquée du parent, pas à la racine.
    const replies = document.querySelector('.comment-list--replies')
    expect(replies).not.toBeNull()
    expect(within(replies as HTMLElement).getByText('Ma réponse')).toBeInTheDocument()
  })
})
