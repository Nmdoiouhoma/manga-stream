import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PROGRESS_STATUSES,
  PROGRESS_STATUS_LABELS,
  useMediaProgress,
  useSaveProgress,
  type ProgressStatus,
} from '../api/progress'
import { useAuth } from '../auth/useAuth'
import { formatChapterNumber, parseDecimal, type MediaDetail } from '../types/media'

/**
 * Progress editor shown on a detail page.
 *
 * The numeric inputs are kept as **strings** in local state. Storing a number
 * would make "" unrepresentable and the field impossible to clear, and for the
 * chapter it would also destroy the decimal the API round-trips as a string
 * (`decimal(8,2)`, "12.50"). Conversion happens once, on submit.
 */
export function ProgressPanel({ media }: { media: MediaDetail }) {
  const { isAuthenticated } = useAuth()
  const { entry, isLoading } = useMediaProgress(media.iri)
  const save = useSaveProgress()

  const isAnime = media.kind === 'anime'

  const [status, setStatus] = useState<ProgressStatus>('PLANNED')
  const [unit, setUnit] = useState('')
  const [score, setScore] = useState('')

  // Re-seed the form whenever the server entry changes (first load, refetch
  // after a save, or navigation between two media without unmounting).
  useEffect(() => {
    setStatus(entry?.status ?? 'PLANNED')
    setUnit(
      isAnime
        ? (entry?.currentEpisode?.toString() ?? '')
        : entry?.currentChapter !== null && entry?.currentChapter !== undefined
          ? formatChapterNumber(entry.currentChapter)
          : '',
    )
    setScore(entry?.score !== null && entry?.score !== undefined ? String(entry.score) : '')
  }, [entry, isAnime])

  if (!isAuthenticated) {
    return (
      <section className="panel panel--soft">
        <h2 className="section__title">Votre progression</h2>
        <p className="muted">
          <Link to="/login" className="link">
            Connectez-vous
          </Link>{' '}
          pour suivre votre avancement, noter et retrouver ce titre dans vos favoris.
        </p>
      </section>
    )
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()

    const trimmedUnit = unit.trim()
    const trimmedScore = score.trim()

    save.mutate({
      targetIri: media.iri,
      kind: media.kind,
      status,
      // An empty field means "not set", which the contract models as null —
      // not as 0, which would claim the user watched zero episodes.
      currentEpisode: isAnime && trimmedUnit !== '' ? Math.trunc(parseDecimal(trimmedUnit)) : null,
      currentChapter: !isAnime && trimmedUnit !== '' ? parseDecimal(trimmedUnit) : null,
      score: trimmedScore !== '' ? clampScore(parseDecimal(trimmedScore)) : null,
      existing: entry,
    })
  }

  const max = media.unitCount ?? undefined
  const unitLabel = isAnime ? 'Épisode courant' : 'Chapitre courant'

  return (
    <section className="panel panel--soft">
      <h2 className="section__title">Votre progression</h2>

      {isLoading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <form className="progress-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field__label">Statut</span>
            <select
              className="select"
              value={status}
              onChange={(event) => setStatus(event.target.value as ProgressStatus)}
            >
              {PROGRESS_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {PROGRESS_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">
              {unitLabel}
              {max ? ` / ${max}` : ''}
            </span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min={0}
              max={max}
              // Half-chapters (12.5) are a real thing; episodes are integers.
              step={isAnime ? 1 : 0.5}
              value={unit}
              placeholder="—"
              onChange={(event) => setUnit(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">Votre note /100</span>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              step={1}
              value={score}
              placeholder="—"
              onChange={(event) => setScore(event.target.value)}
            />
          </label>

          <div className="progress-form__actions">
            <button type="submit" className="btn btn--primary" disabled={save.isPending}>
              {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {save.isError && (
              <span className="form__error" role="alert">
                {save.error instanceof Error ? save.error.message : 'Échec de l’enregistrement'}
              </span>
            )}
            {save.isSuccess && !save.isPending && <span className="form__ok">Enregistré</span>}
          </div>
        </form>
      )}

      {entry && max ? <ProgressBar current={currentUnit(entry.kind === 'anime', entry.currentEpisode, entry.currentChapter)} total={max} /> : null}
    </section>
  )
}

function currentUnit(isAnime: boolean, episode: number | null, chapter: number | null) {
  return (isAnime ? episode : chapter) ?? 0
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0
  return (
    <div className="progress-bar" role="img" aria-label={`${current} sur ${total}`}>
      <div className="progress-bar__fill" style={{ width: `${ratio * 100}%` }} />
      <span className="progress-bar__label">
        {formatChapterNumber(current)} / {total}
      </span>
    </div>
  )
}
