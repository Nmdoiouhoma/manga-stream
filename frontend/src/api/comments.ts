/**
 * Comment threads on a media detail page.
 *
 * ── Why the tree is built client-side ─────────────────────────────────────
 * The contract exposes `replies[]` only on the **item** read group
 * (`Comment.jsonld-comment.read_comment.item.read`), not on the collection one.
 * Rendering a thread from the collection would therefore mean one extra
 * request per root comment. Instead we fetch every comment of the media in a
 * single call and rebuild the parent/child tree from the `parent` field, which
 * the collection group *does* expose. Same result, one request.
 *
 * The domain is documented as "fil de discussion à un niveau de réponse", so
 * the tree is deliberately flattened to two levels: a root and its replies.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from './client'
import { normalizeCollection } from './hydra'
import { useAuth } from '../auth/useAuth'
import { idFromIri, type MediaKind } from '../types/media'
import type { components, paths } from './schema'

type Comment = components['schemas']['Comment.jsonld-comment.read']
type CommentWrite = components['schemas']['Comment-comment.write']

/**
 * ⚠️ Écart de contrat, corrigé côté backend mais **pas encore régénéré**.
 *
 * `Comment.parent` est décrit — en lecture comme en écriture — par un objet
 * `Comment` imbriqué au lieu d'une `iri-reference`, contrairement à toutes les
 * autres relations (`user`, `anime`, `manga` sont en `format: iri-reference`).
 * L'association est récursive et la fabrique OpenAPI en déduisait un lien
 * embarqué.
 *
 * Le backend l'a corrigé le 2026-08-02 (`readableLink`/`writableLink` à
 * `false`) et l'API renvoie bien une IRI — vérifié :
 * `"parent": "/api/comments/11"`. Mais `docs/openapi.yaml` n'a pas encore été
 * régénéré, donc le type généré ment toujours dans les deux sens.
 *
 * Conséquence concrète, et c'est pour ça que ce n'est pas cosmétique : lire
 * `comment.parent?.['@id']` sur une chaîne renvoie `undefined`, chaque réponse
 * devient orpheline et le fil s'aplatit en une liste de racines. D'où
 * `parentIriOf()`, qui accepte les deux formes. À conserver après la
 * régénération : c'est ce qui rend la lecture indifférente à la forme servie.
 */
type CommentWriteBody = Omit<CommentWrite, 'parent'> & { parent?: string | null }

/**
 * IRI du parent, que l'API la serve en chaîne (forme réelle depuis le
 * 2026-08-02) ou en objet embarqué (forme encore décrite par le contrat).
 */
function parentIriOf(comment: Comment): string | null {
  // `unknown` plutôt qu'un cast direct : le type généré affirme un objet, la
  // réalité est une chaîne, et seule une inspection à l'exécution tranche.
  const parent: unknown = comment.parent
  if (typeof parent === 'string') return parent.trim() || null
  if (typeof parent === 'object' && parent !== null) {
    const iri = (parent as Record<string, unknown>)['@id']
    if (typeof iri === 'string') return iri
  }
  return null
}
type CommentPostBody = NonNullable<
  paths['/api/comments']['post']['requestBody']
>['content']['application/ld+json']

/** A comment, flattened, with its replies attached. */
export type CommentNode = {
  iri: string
  id: number | null
  content: string
  /** `null` when the API omitted the author (see `toNode`). */
  authorIri: string | null
  authorName: string
  createdAt: string | null
  parentIri: string | null
  replies: CommentNode[]
  /** True while the server has not confirmed the creation yet. */
  pending?: boolean
}

function toNode(comment: Comment): CommentNode {
  // `user` became optional in the 2026-08-02 contract (the backend assigns the
  // owner server-side). It is always present in practice, but an absent author
  // must not crash the thread — and, more importantly, must not be mistaken for
  // "the current user", which would offer a Delete button on someone else's
  // comment. `authorIri: null` never matches, so the button stays hidden.
  return {
    iri: comment['@id'],
    id: comment.id ?? idFromIri(comment['@id']),
    content: comment.content,
    authorIri: comment.user?.['@id'] ?? null,
    authorName: comment.user?.username || 'Utilisateur',
    createdAt: comment.createdAt ?? null,
    parentIri: parentIriOf(comment),
    replies: [],
  }
}

/** Rebuilds the two-level thread from the flat collection. */
function buildThread(comments: Comment[]): CommentNode[] {
  const nodes = comments.map(toNode)
  const byIri = new Map(nodes.map((node) => [node.iri, node]))
  const roots: CommentNode[] = []

  for (const node of nodes) {
    const parent = node.parentIri ? byIri.get(node.parentIri) : undefined
    if (parent) parent.replies.push(node)
    // An orphan reply (parent outside this media, or deleted) is promoted to a
    // root rather than silently dropped — losing a user's message is worse
    // than showing it slightly out of place.
    else roots.push(node)
  }

  const byDateAsc = (a: CommentNode, b: CommentNode) =>
    (a.createdAt ?? '').localeCompare(b.createdAt ?? '')

  for (const node of nodes) node.replies.sort(byDateAsc)
  // Newest conversations first, but replies chronological inside a thread.
  return roots.sort((a, b) => -byDateAsc(a, b))
}

export function commentsQueryKey(targetIri: string | undefined) {
  return ['comments', targetIri] as const
}

export function useComments(kind: MediaKind, targetIri: string | undefined) {
  const query = useQuery<CommentNode[]>({
    queryKey: commentsQueryKey(targetIri),
    enabled: Boolean(targetIri),
    queryFn: async () => {
      const result = await apiClient.GET('/api/comments', {
        params: {
          query: {
            ...(kind === 'anime' ? { anime: targetIri } : { manga: targetIri }),
            itemsPerPage: 100,
            'order[createdAt]': 'desc',
          },
        },
      })
      return buildThread(normalizeCollection(unwrap(result)).member)
    },
  })

  return { ...query, comments: query.data ?? [] }
}

export type AddCommentInput = {
  kind: MediaKind
  targetIri: string
  content: string
  /** IRI of the comment being replied to, when this is a reply. */
  parentIri?: string | null
}

export function useAddComment() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: AddCommentInput) => {
      if (!user) throw new Error('Connectez-vous pour commenter.')

      // `user` is deliberately NOT sent: it became optional in the 2026-08-02
      // contract because the backend assigns the owner from the JWT. Sending it
      // would be at best redundant, at worst a way to disagree with the server.
      const body: CommentWriteBody = {
        content: input.content,
        ...(input.kind === 'anime' ? { anime: input.targetIri } : { manga: input.targetIri }),
        ...(input.parentIri ? { parent: input.parentIri } : {}),
      }

      const result = await apiClient.POST('/api/comments', {
        // See `CommentWriteBody`: IRI instead of the contract's nested object.
        body: body as CommentPostBody,
      })
      return unwrap(result)
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: commentsQueryKey(input.targetIri) })
    },
  })
}

export function useDeleteComment(targetIri: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (comment: CommentNode) => {
      if (comment.id === null) throw new Error('Commentaire non enregistré.')
      const result = await apiClient.DELETE('/api/comments/{id}', {
        params: { path: { id: String(comment.id) } },
      })
      // 204 No Content — nothing to unwrap, only the error to surface.
      if (result.error) {
        const detail =
          typeof result.error === 'object' && result.error !== null && 'detail' in result.error
            ? String((result.error as { detail: unknown }).detail)
            : `Suppression impossible (${result.response.status})`
        throw new Error(detail)
      }
    },

    // Optimistic removal, with the whole thread snapshotted for rollback.
    onMutate: async (comment: CommentNode) => {
      const key = commentsQueryKey(targetIri)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<CommentNode[]>(key) ?? []

      const prune = (nodes: CommentNode[]): CommentNode[] =>
        nodes
          .filter((node) => node.iri !== comment.iri)
          .map((node) => ({ ...node, replies: prune(node.replies) }))

      queryClient.setQueryData(key, prune(previous))
      return { previous }
    },

    onError: (_error, _comment, context) => {
      if (context?.previous) {
        queryClient.setQueryData(commentsQueryKey(targetIri), context.previous)
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: commentsQueryKey(targetIri) })
    },
  })
}
