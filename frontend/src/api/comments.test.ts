/**
 * `buildThread` reconstruit le fil de discussion à partir de la collection
 * plate servie par l'API : le groupe de lecture « collection » n'expose pas
 * `replies[]`, seulement `parent`.
 *
 * Deux comportements méritent d'être ancrés :
 *  - le fil reste à **deux niveaux**, comme le domaine le documente ;
 *  - une réponse **orpheline** (parent hors de cette œuvre, ou supprimé) est
 *    promue en racine et non silencieusement perdue — perdre le message d'un
 *    utilisateur est pire que l'afficher légèrement mal placé.
 */
import { describe, expect, it } from 'vitest'
import { buildThread } from './comments'
import type { components } from './schema'

type Comment = components['schemas']['Comment.jsonld-comment.read']

function comment(
  id: number,
  content: string,
  options: { parent?: string | null; createdAt?: string; username?: string } = {},
): Comment {
  return {
    '@id': `/api/comments/${id}`,
    '@type': 'Comment',
    id,
    content,
    createdAt: options.createdAt ?? `2026-08-0${id}T10:00:00+00:00`,
    parent: options.parent ?? null,
    user: {
      '@id': '/api/users/1',
      '@type': 'User',
      id: 1,
      username: options.username ?? 'lecteur',
    },
  }
}

describe('buildThread', () => {
  it('rattache les réponses à leur racine, sur deux niveaux', () => {
    const thread = buildThread([
      comment(1, 'Racine'),
      comment(2, 'Réponse', { parent: '/api/comments/1' }),
      comment(3, 'Autre réponse', { parent: '/api/comments/1' }),
    ])

    expect(thread).toHaveLength(1)
    expect(thread[0].content).toBe('Racine')
    expect(thread[0].replies.map((reply) => reply.content)).toEqual(['Réponse', 'Autre réponse'])
    // Deux niveaux : une réponse n'a jamais de réponse à elle.
    expect(thread[0].replies.every((reply) => reply.replies.length === 0)).toBe(true)
  })

  it('conserve une racine sans réponse', () => {
    const thread = buildThread([comment(1, 'Seul au monde')])

    expect(thread).toHaveLength(1)
    expect(thread[0].parentIri).toBeNull()
    expect(thread[0].replies).toEqual([])
  })

  it('promeut en racine une réponse dont le parent est absent de la collection', () => {
    const thread = buildThread([
      comment(1, 'Racine'),
      comment(9, 'Réponse orpheline', { parent: '/api/comments/404' }),
    ])

    expect(thread.map((node) => node.content).sort()).toEqual(['Racine', 'Réponse orpheline'])
    expect(thread).toHaveLength(2)
  })

  it('classe les fils du plus récent au plus ancien, mais les réponses dans l’ordre', () => {
    const thread = buildThread([
      comment(1, 'Ancien fil', { createdAt: '2026-08-01T10:00:00+00:00' }),
      comment(2, 'Fil récent', { createdAt: '2026-08-03T10:00:00+00:00' }),
      comment(3, 'Deuxième réponse', {
        parent: '/api/comments/1',
        createdAt: '2026-08-02T12:00:00+00:00',
      }),
      comment(4, 'Première réponse', {
        parent: '/api/comments/1',
        createdAt: '2026-08-02T09:00:00+00:00',
      }),
    ])

    expect(thread.map((node) => node.content)).toEqual(['Fil récent', 'Ancien fil'])
    expect(thread[1].replies.map((reply) => reply.content)).toEqual([
      'Première réponse',
      'Deuxième réponse',
    ])
  })

  it('n’attribue pas la propriété d’un commentaire sans auteur', () => {
    // `user` est optionnel depuis le contrat du 2026-08-02. Un `authorIri`
    // inventé ferait apparaître « Supprimer » sur le commentaire d'autrui.
    const anonymous: Comment = {
      '@id': '/api/comments/7',
      '@type': 'Comment',
      id: 7,
      content: 'Sans auteur',
      createdAt: '2026-08-01T10:00:00+00:00',
      parent: null,
    }

    const [node] = buildThread([anonymous])

    expect(node.authorIri).toBeNull()
    expect(node.authorName).toBe('Utilisateur')
  })

  it('rend une collection vide sans lever', () => {
    expect(buildThread([])).toEqual([])
  })
})
