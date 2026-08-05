/**
 * Le fil de commentaires se met à jour sans rechargement.
 *
 * Deux choses sont vérifiées ici, et la première est la plus fragile : le topic
 * auquel le navigateur s'abonne doit être **exactement** celui que le backend
 * publie. Rien ne relie les deux conventions à la compilation — un écart d'une
 * lettre ne casse aucun test côté PHP, aucun type côté TS, et se manifeste
 * seulement par un fil qui ne bouge jamais. Les littéraux sont donc écrits en
 * toutes lettres des deux côtés : ici, et dans
 * `CommentBroadcastTest::testTheTopicConventionIsScopedByMedia()`.
 *
 * La seconde est le comportement attendu : un message reçu provoque une
 * relecture de l'API, et le commentaire d'un tiers apparaît.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommentThread } from '../components/CommentThread'
import { AuthProvider } from '../auth/AuthContext'
import { commentsQueryKey, type CommentNode } from '../api/comments'
import { setSession } from '../auth/session'
import { setFetchHandler } from '../test/http'
import { commentTopicFor } from './useCommentStream'

const TARGET_IRI = '/api/animes/1'
const HUB_URL = 'http://localhost:3000/.well-known/mercure'

/**
 * `EventSource` n'existe pas dans jsdom. Ce double se contente d'enregistrer
 * l'URL demandée et de laisser le test pousser un message.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = []

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  closed = false

  // Champs déclarés puis affectés, et non des propriétés de constructeur : le
  // projet compile en `erasableSyntaxOnly`, qui interdit la forme courte.
  readonly url: string
  readonly init?: EventSourceInit

  constructor(url: string, init?: EventSourceInit) {
    this.url = url
    this.init = init
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.closed = true
  }

  /** Simule une update poussée par le hub. */
  emit(payload: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }))
  }
}

function existing(): CommentNode {
  return {
    iri: '/api/comments/1',
    id: 1,
    content: 'Un commentaire déjà là',
    authorIri: '/api/users/2',
    authorName: 'quelqun',
    createdAt: '2026-08-01T10:00:00+00:00',
    parentIri: null,
    replies: [],
  }
}

function collection(members: unknown[]): Response {
  return new Response(
    JSON.stringify({
      '@context': '/api/contexts/Comment',
      '@id': '/api/comments',
      '@type': 'Collection',
      totalItems: members.length,
      member: members,
    }),
    { status: 200, headers: { 'Content-Type': 'application/ld+json' } },
  )
}

function renderThread() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  // Le fil de départ vient du cache : sans invalidation, aucune requête ne part
  // et rien ne change à l'écran. C'est ce qui rend le test probant.
  client.setQueryData(commentsQueryKey(TARGET_IRI), [existing()])

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <CommentThread kind="anime" targetIri={TARGET_IRI} />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource

  setSession({
    token: 'jeton-de-test',
    user: {
      iri: '/api/users/1',
      id: 1,
      username: 'testeur',
      email: 't@example.test',
      roles: ['ROLE_USER'],
    },
    // Sans abonnement, le transport n'a pas d'URL de hub et n'ouvre rien.
    mercure: { hubUrl: HUB_URL, topic: '/api/users/1/notifications', token: 'jeton-abonne' },
  })
})

afterEach(() => {
  setSession(null)
})

describe('commentTopicFor', () => {
  it('reprend mot pour mot la convention du backend', () => {
    expect(commentTopicFor('anime', '/api/animes/12')).toBe('/api/animes/12/comments')
    expect(commentTopicFor('manga', '/api/mangas/12')).toBe('/api/mangas/12/comments')
  })

  it('ne fabrique pas de topic sans cible identifiable', () => {
    expect(commentTopicFor('anime', undefined)).toBeNull()
    expect(commentTopicFor('anime', '/api/animes/pas-un-nombre')).toBeNull()
  })
})

describe('CommentThread — temps réel', () => {
  it("s'abonne au fil de l'œuvre affichée, et à lui seul", async () => {
    setFetchHandler(() => collection([]))
    renderThread()

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))

    const topics = new URL(FakeEventSource.instances[0].url).searchParams.getAll('topic')
    expect(topics).toEqual(['/api/animes/1/comments'])
  })

  it("affiche le commentaire d'un tiers à la réception d'une update", async () => {
    setFetchHandler(() =>
      collection([
        {
          '@id': '/api/comments/1',
          '@type': 'Comment',
          id: 1,
          content: 'Un commentaire déjà là',
          user: { '@id': '/api/users/2', username: 'quelqun' },
          createdAt: '2026-08-01T10:00:00+00:00',
          parent: null,
        },
        {
          '@id': '/api/comments/2',
          '@type': 'Comment',
          id: 2,
          content: "Posté par quelqu'un d'autre",
          user: { '@id': '/api/users/3', username: 'autrui' },
          createdAt: '2026-08-01T11:00:00+00:00',
          parent: null,
        },
      ]),
    )
    renderThread()

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    expect(screen.queryByText("Posté par quelqu'un d'autre")).not.toBeInTheDocument()

    await act(async () => {
      FakeEventSource.instances[0].emit({ '@type': 'Comment', '@id': '/api/comments/2' })
    })

    expect(await screen.findByText("Posté par quelqu'un d'autre")).toBeInTheDocument()
  })

  it('ne se connecte à rien pour un visiteur anonyme', async () => {
    setSession(null)
    setFetchHandler(() => collection([]))
    renderThread()

    // Laisse passer les effets : rien ne doit s'ouvrir, ni maintenant ni après.
    await act(async () => {
      await Promise.resolve()
    })
    expect(FakeEventSource.instances).toHaveLength(0)
  })
})
