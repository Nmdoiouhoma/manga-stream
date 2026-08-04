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
import type { components } from './schema'

type Comment = components['schemas']['Comment.jsonld-comment.read']
type CommentWrite = components['schemas']['Comment-comment.write']

/**
 * Corps d'écriture d'un commentaire.
 *
 * ── Contournement retiré ──────────────────────────────────────────────────
 * `Comment.parent` était décrit — en lecture comme en écriture — par un objet
 * `Comment` imbriqué au lieu d'une `iri-reference`, contrairement à toutes les
 * autres relations. L'association étant récursive, API Platform en déduisait
 * un lien embarqué. Le front devait donc réécrire le type à la main pour
 * envoyer une IRI, et lisait `parent['@id']` — ce qui aurait renvoyé
 * `undefined` sur la chaîne réellement servie, orphelinant chaque réponse et
 * aplatissant le fil en liste de racines.
 *
 * Écart remonté, **corrigé** le 2026-08-02 (`readableLink`/`writableLink` à
 * `false`) et contrat régénéré : `parent` est maintenant
 * `string | null` avec `format: iri-reference`, dans les deux sens. Le type
 * généré est repris tel quel, et `parent` se lit directement.
 */
type CommentWriteBody = CommentWrite

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
    parentIri: comment.parent ?? null,
    replies: [],
  }
}

/**
 * Rebuilds the two-level thread from the flat collection.
 *
 * Exportée pour être testée directement : c'est la seule fonction du module qui
 * porte une vraie logique, et la couvrir à travers un rendu de composant
 * reviendrait à tester React plutôt que la reconstruction du fil.
 */
export function buildThread(comments: Comment[]): CommentNode[] {
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

/**
 * Identifiant local d'un commentaire pas encore confirmé.
 *
 * Un compteur, et pas seulement l'horodatage : deux envois dans la même
 * milliseconde partageraient la clé React, et le second remplacerait le premier
 * à l'écran. Le préfixe garantit de ne jamais entrer en collision avec une IRI
 * servie par l'API.
 */
let optimisticSeq = 0
function optimisticIri(): string {
  optimisticSeq += 1
  return `optimistic:comment:${Date.now()}:${optimisticSeq}`
}

/**
 * Insère un nœud optimiste dans le fil déjà en cache.
 *
 * Une réponse rejoint son parent en fin de liste (les réponses sont
 * chronologiques) ; une racine passe en tête (les fils les plus récents en
 * premier), ce qui reproduit l'ordre de `buildThread`. Un parent introuvable
 * retombe en racine, exactement comme une réponse orpheline servie par l'API :
 * mieux vaut le message légèrement mal placé que pas de message du tout.
 */
function insertOptimistic(
  thread: CommentNode[],
  node: CommentNode,
  parentIri: string | null,
): CommentNode[] {
  if (!parentIri) return [node, ...thread]

  let attached = false
  const next = thread.map((root) => {
    if (root.iri !== parentIri) return root
    attached = true
    return { ...root, replies: [...root.replies, node] }
  })

  return attached ? next : [node, ...thread]
}

/**
 * Publication d'un commentaire.
 *
 * ── Pourquoi une mise à jour optimiste ────────────────────────────────────
 * Le symptôme rapporté était qu'un commentaire racine n'apparaissait qu'après
 * un rechargement. L'invalidation seule (`onSuccess`) dépend de toute une
 * chaîne — la mutation doit aboutir, la requête doit être *active*, le refetch
 * doit passer, et rien ne doit intercepter la requête entre-temps. Écrire
 * directement dans le cache court-circuite cette chaîne : le message est à
 * l'écran au moment du clic, et il en repart si le serveur refuse.
 *
 * `useDeleteComment` procède déjà ainsi ; c'était l'asymétrie fautive.
 */
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

      const result = await apiClient.POST('/api/comments', { body })
      return unwrap(result)
    },

    onMutate: async (input: AddCommentInput) => {
      const key = commentsQueryKey(input.targetIri)
      // Sans ça, un refetch déjà en vol écraserait le nœud optimiste par une
      // réponse serveur antérieure à l'envoi.
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<CommentNode[]>(key) ?? []

      const node: CommentNode = {
        iri: optimisticIri(),
        // `null` et non un faux id : le bouton « Supprimer » refuse un
        // commentaire sans id plutôt que d'appeler /api/comments/null.
        id: null,
        content: input.content,
        authorIri: user?.iri ?? null,
        authorName: user?.username || 'Vous',
        createdAt: new Date().toISOString(),
        parentIri: input.parentIri ?? null,
        replies: [],
        pending: true,
      }

      queryClient.setQueryData(key, insertOptimistic(previous, node, input.parentIri ?? null))
      return { previous }
    },

    onError: (_error, input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(commentsQueryKey(input.targetIri), context.previous)
      }
    },

    // `onSettled` et pas `onSuccess` : après un échec, le fil rétabli peut
    // lui-même être périmé (c'est peut-être un conflit qui a fait échouer
    // l'envoi), et refetcher est de toute façon la bonne conclusion.
    onSettled: (_data, _error, input) => {
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
