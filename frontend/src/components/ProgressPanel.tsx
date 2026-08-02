import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api/client'
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
 *
 * ── Cohérence statut / progression ────────────────────────────────────────
 * Rien n'empêchait d'enregistrer « Terminé, épisode 1 » sur un anime de 25
 * épisodes. Le formulaire tient maintenant l'invariant que MyAnimeList et
 * AniList appliquent :
 *
 *   COMPLETED  ⟹  progression = total
 *
 * Concrètement : choisir « Terminé » pré-remplit le champ au total et le
 * verrouille ; atteindre le total **propose** « Terminé » sans l'imposer —
 * abandonner une série à son dernier épisode est un cas réel.
 *
 * Le verrou ne s'applique que si le total est connu. `episodeCount` /
 * `chapterCount` viennent d'AniList et manquent souvent sur les séries en
 * cours : One Piece n'en a aucun. Sans total, on ne verrouille rien et on ne
 * suggère rien — la saisie reste libre.
 *
 * Le backend valide la même règle et répond 422 ; ses violations sont affichées
 * telles quelles, ce garde-fou d'interface n'étant pas une garantie (données
 * de contrat divergentes, requête concurrente).
 */
export function ProgressPanel({ media }: { media: MediaDetail }) {
  const { isAuthenticated } = useAuth()
  const { entry, isLoading } = useMediaProgress(media.iri)
  const save = useSaveProgress()

  const isAnime = media.kind === 'anime'

  const [status, setStatus] = useState<ProgressStatus>('PLANNED')
  const [unit, setUnit] = useState('')
  const [score, setScore] = useState('')
  // La suggestion « passer en terminé » est refusable : une fois écartée elle
  // ne revient qu'après une nouvelle saisie, sinon elle harcèle.
  const [suggestionDismissed, setSuggestionDismissed] = useState(false)

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
    setSuggestionDismissed(false)
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

  const total = media.unitCount
  // `> 0` autant que `!== null` : un total à zéro est une donnée d'import
  // dégradée, pas une œuvre sans épisode, et verrouiller le champ à 0 serait
  // absurde.
  const totalKnown = total !== null && total > 0
  /** Le champ est piloté par le statut : « Terminé » ⟹ progression = total. */
  const lockedToTotal = status === 'COMPLETED' && totalKnown

  const trimmedUnit = unit.trim()
  const typedValue = trimmedUnit === '' ? null : parseDecimal(trimmedUnit, Number.NaN)
  const reachedTotal =
    totalKnown && typedValue !== null && Number.isFinite(typedValue) && typedValue >= total
  const suggestCompletion = reachedTotal && status !== 'COMPLETED' && !suggestionDismissed

  const handleStatusChange = (next: ProgressStatus) => {
    setStatus(next)
    // Pré-remplissage, pas simple grisage : sans lui, le champ afficherait
    // encore l'ancienne valeur tout en étant verrouillé, et l'utilisateur
    // n'aurait aucun moyen de comprendre ce qui sera enregistré.
    if (next === 'COMPLETED' && totalKnown) {
      setUnit(isAnime ? String(total) : formatChapterNumber(total))
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()

    const trimmedScore = score.trim()
    // Ceinture et bretelles : le champ est déjà verrouillé sur le total, mais
    // un `disabled` n'est pas une garantie de valeur (état hérité d'un rendu
    // précédent, saisie automatique du navigateur).
    const effectiveUnit = lockedToTotal ? String(total) : trimmedUnit

    save.mutate({
      targetIri: media.iri,
      kind: media.kind,
      status,
      // An empty field means "not set", which the contract models as null —
      // not as 0, which would claim the user watched zero episodes.
      currentEpisode:
        isAnime && effectiveUnit !== '' ? Math.trunc(parseDecimal(effectiveUnit)) : null,
      currentChapter: !isAnime && effectiveUnit !== '' ? parseDecimal(effectiveUnit) : null,
      score: trimmedScore !== '' ? clampScore(parseDecimal(trimmedScore)) : null,
      existing: entry,
    })
  }

  const max = totalKnown ? total : undefined
  const unitLabel = isAnime ? 'Épisode courant' : 'Chapitre courant'
  const errorMessages = readErrors(save.error)

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
              onChange={(event) => handleStatusChange(event.target.value as ProgressStatus)}
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
              type="number"
              inputMode="decimal"
              min={0}
              max={max}
              // Half-chapters (12.5) are a real thing; episodes are integers.
              step={isAnime ? 1 : 0.5}
              value={unit}
              placeholder="—"
              // `readOnly` et non `disabled`, pour une raison d'accessibilité :
              // un champ `disabled` sort de l'ordre de tabulation et n'est
              // annoncé par aucun lecteur d'écran — l'utilisateur ne saurait
              // même pas qu'il existe, ni pourquoi il vaut 25. `readOnly` reste
              // focalisable, annoncé, et refuse la saisie. Le grisage est fait
              // en CSS via `is-locked`.
              readOnly={lockedToTotal}
              className={`input ${lockedToTotal ? 'is-locked' : ''}`}
              aria-describedby={lockedToTotal ? 'progress-unit-hint' : undefined}
              onChange={(event) => {
                setUnit(event.target.value)
                setSuggestionDismissed(false)
              }}
            />
            {lockedToTotal && (
              <span className="field__hint" id="progress-unit-hint">
                Une œuvre terminée est à son total ({total}) : le champ est renseigné
                automatiquement. Changez de statut pour le modifier.
              </span>
            )}
            {status === 'COMPLETED' && !totalKnown && (
              <span className="field__hint">
                Le nombre total {isAnime ? "d'épisodes" : 'de chapitres'} n'est pas connu pour ce
                titre — saisissez votre avancement à la main.
              </span>
            )}
          </label>

          {suggestCompletion && (
            <div className="notice notice--suggest" role="status">
              <span>
                Vous êtes au dernier {isAnime ? 'épisode' : 'chapitre'} ({total}). Marquer ce titre
                comme terminé ?
              </span>
              <span className="notice__actions">
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  onClick={() => handleStatusChange('COMPLETED')}
                >
                  Marquer comme terminé
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => setSuggestionDismissed(true)}
                >
                  Non merci
                </button>
              </span>
            </div>
          )}

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
            {save.isSuccess && !save.isPending && <span className="form__ok">Enregistré</span>}
          </div>

          {errorMessages.length > 0 && (
            <div className="form__error" role="alert">
              {errorMessages.length === 1 ? (
                <p>{errorMessages[0]}</p>
              ) : (
                <ul className="form__error-list">
                  {errorMessages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>
      )}

      {entry && max ? <ProgressBar current={currentUnit(entry.kind === 'anime', entry.currentEpisode, entry.currentChapter)} total={max} /> : null}
    </section>
  )
}

/**
 * Messages d'erreur présentables pour un échec d'enregistrement.
 *
 * Un 422 porte une violation par champ : les afficher séparément vaut mieux que
 * la phrase agrégée d'API Platform, qui préfixe chaque message du chemin de
 * propriété interne (« currentEpisode: … »). Tout le reste retombe sur le
 * message déjà nettoyé par `unwrap()` — jamais une trace technique brute.
 */
function readErrors(error: unknown): string[] {
  if (!error) return []
  if (error instanceof ApiError && error.violations.length > 0) {
    return error.violations.map((violation) => violation.message)
  }
  if (error instanceof Error && error.message) return [error.message]
  return ['Échec de l’enregistrement.']
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
