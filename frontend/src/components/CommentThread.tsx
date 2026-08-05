import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAddComment,
  useComments,
  useDeleteComment,
  type CommentNode,
} from '../api/comments'
import { useAuth } from '../auth/useAuth'
import { Avatar } from './Avatar'
import { useCommentStream } from '../hooks/useCommentStream'
import { formatDate, type MediaKind } from '../types/media'

const MAX_LENGTH = 2000

export function CommentThread({ kind, targetIri }: { kind: MediaKind; targetIri: string }) {
  const { user, isAuthenticated } = useAuth()
  const { comments, isLoading, isError, error } = useComments(kind, targetIri)
  // Le fil se met à jour tout seul tant qu'on le regarde. Rien n'en dépend à
  // l'affichage : sans hub, sans jeton ou hors connexion, le composant se
  // comporte exactement comme avant.
  useCommentStream(kind, targetIri)
  const addComment = useAddComment()
  const deleteComment = useDeleteComment(targetIri)

  /** IRI of the comment currently being replied to, if any. */
  const [replyTo, setReplyTo] = useState<string | null>(null)

  const total = comments.reduce((sum, node) => sum + 1 + node.replies.length, 0)

  return (
    <section className="panel comments">
      <h2 className="section__title">
        Commentaires {total > 0 && <span className="section__count">{total}</span>}
      </h2>

      {isAuthenticated ? (
        <CommentForm
          placeholder="Votre commentaire…"
          submitLabel="Publier"
          pending={addComment.isPending && replyTo === null}
          error={replyTo === null ? addComment.error : null}
          onSubmit={(content) =>
            addComment.mutate(
              { kind, targetIri, content },
              { onSuccess: () => setReplyTo(null) },
            )
          }
        />
      ) : (
        <p className="muted">
          <Link to="/login" className="link">
            Connectez-vous
          </Link>{' '}
          pour participer à la discussion.
        </p>
      )}

      {isLoading && <p className="muted">Chargement des commentaires…</p>}

      {isError && (
        <p className="form__error" role="alert">
          {error instanceof Error ? error.message : 'Commentaires indisponibles'}
        </p>
      )}

      {!isLoading && !isError && comments.length === 0 && (
        <p className="muted">Aucun commentaire pour l’instant. Soyez le premier.</p>
      )}

      <ul className="comment-list">
        {comments.map((comment) => (
          <li key={comment.iri}>
            <CommentItem
              comment={comment}
              currentUserIri={user?.iri ?? null}
              canReply={isAuthenticated}
              isReplyOpen={replyTo === comment.iri}
              onToggleReply={() => setReplyTo(replyTo === comment.iri ? null : comment.iri)}
              onDelete={() => deleteComment.mutate(comment)}
              onReply={(content) =>
                addComment.mutate(
                  { kind, targetIri, content, parentIri: comment.iri },
                  { onSuccess: () => setReplyTo(null) },
                )
              }
              replyPending={addComment.isPending && replyTo === comment.iri}
              replyError={replyTo === comment.iri ? addComment.error : null}
            />

            {comment.replies.length > 0 && (
              <ul className="comment-list comment-list--replies">
                {comment.replies.map((reply) => (
                  <li key={reply.iri}>
                    <CommentItem
                      comment={reply}
                      currentUserIri={user?.iri ?? null}
                      canReply={false}
                      isReplyOpen={false}
                      onToggleReply={() => undefined}
                      onDelete={() => deleteComment.mutate(reply)}
                      onReply={() => undefined}
                      replyPending={false}
                      replyError={null}
                    />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {deleteComment.isError && (
        <p className="form__error" role="alert">
          {deleteComment.error instanceof Error
            ? deleteComment.error.message
            : 'Suppression impossible'}
        </p>
      )}
    </section>
  )
}

type ItemProps = {
  comment: CommentNode
  currentUserIri: string | null
  canReply: boolean
  isReplyOpen: boolean
  onToggleReply: () => void
  onDelete: () => void
  onReply: (content: string) => void
  replyPending: boolean
  replyError: unknown
}

function CommentItem({
  comment,
  currentUserIri,
  canReply,
  isReplyOpen,
  onToggleReply,
  onDelete,
  onReply,
  replyPending,
  replyError,
}: ItemProps) {
  // Deletion is offered to the author only. The backend enforces it for real;
  // this is presentation, not security.
  const isAuthor = currentUserIri !== null && comment.authorIri === currentUserIri
  // Affiché immédiatement, pas encore confirmé par le serveur : il n'a donc ni
  // id ni IRI réelle, et ni « Répondre » ni « Supprimer » ne peuvent le viser.
  const isPending = comment.pending === true

  return (
    <article className={`comment ${isPending ? 'is-pending' : ''}`}>
      <header className="comment__head">
        <Avatar name={comment.authorName} size="sm" />
        <span className="comment__author">{comment.authorName}</span>
        {isPending ? (
          // Formulé autrement que le bouton (« Envoi… ») : les deux
          // apparaissent en même temps, et deux libellés identiques à l'écran
          // laissent croire à un doublon.
          <span className="comment__date">envoi en cours</span>
        ) : (
          comment.createdAt && (
            <time className="comment__date" dateTime={comment.createdAt}>
              {formatDate(comment.createdAt)}
            </time>
          )
        )}
      </header>

      <p className="comment__body">{comment.content}</p>

      <footer className="comment__actions">
        {canReply && !isPending && (
          <button type="button" className="btn btn--link" onClick={onToggleReply}>
            {isReplyOpen ? 'Annuler' : 'Répondre'}
          </button>
        )}
        {isAuthor && !isPending && (
          <button type="button" className="btn btn--link btn--danger" onClick={onDelete}>
            Supprimer
          </button>
        )}
      </footer>

      {isReplyOpen && (
        <CommentForm
          placeholder={`Répondre à ${comment.authorName}…`}
          submitLabel="Répondre"
          pending={replyPending}
          error={replyError}
          onSubmit={onReply}
        />
      )}
    </article>
  )
}

type FormProps = {
  placeholder: string
  submitLabel: string
  pending: boolean
  error: unknown
  onSubmit: (content: string) => void
}

function CommentForm({ placeholder, submitLabel, pending, error, onSubmit }: FormProps) {
  const [content, setContent] = useState('')
  const trimmed = content.trim()

  return (
    <form
      className="comment-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (trimmed === '') return
        onSubmit(trimmed)
        setContent('')
      }}
    >
      <textarea
        className="textarea"
        rows={3}
        maxLength={MAX_LENGTH}
        placeholder={placeholder}
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      <div className="comment-form__actions">
        <button type="submit" className="btn btn--primary" disabled={pending || trimmed === ''}>
          {pending ? 'Envoi…' : submitLabel}
        </button>
        {error instanceof Error && (
          <span className="form__error" role="alert">
            {error.message}
          </span>
        )}
      </div>
    </form>
  )
}
