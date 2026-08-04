/**
 * « Ma liste » — l'écran quotidien d'un tracker.
 *
 * Sur MyAnimeList ou AniList, c'est la page qu'on ouvre tous les jours, bien
 * plus que le catalogue. Elle manquait entièrement : `Progress` portait ses
 * cinq statuts, l'API les filtrait et les cloisonnait déjà par utilisateur,
 * mais rien côté front ne les montrait autrement qu'en histogramme sur le
 * profil.
 *
 * ── Un seul appel, tout le tri en local ───────────────────────────────────
 * `/api/progress` accepte bien un filtre `status`, mais chaque onglet doit
 * afficher **son compteur** : filtrer côté serveur voudrait dire six requêtes
 * pour peindre une barre d'onglets, et un aller-retour à chaque clic. Une
 * liste personnelle tient dans la ou les deux pages que `useProgressList`
 * ramène déjà ; tout le reste (onglets, type, tri) se fait sur ce tableau.
 *
 * ── Le « +1 » est la raison d'être de l'écran ─────────────────────────────
 * Le geste le plus fréquent d'un tracker est « j'ai regardé l'épisode
 * suivant ». L'imposer via la fiche — ouvrir, faire défiler, cocher, revenir —
 * est ce qui fait qu'on ne tient pas sa liste. Il est donc sur la ligne.
 *
 * ── Typage ────────────────────────────────────────────────────────────────
 * `Progress.currentChapter` est un `decimal(8,2)` sérialisé en **string**
 * JSON. `ProgressEntry` le livre déjà parsé ; l'affichage repasse par
 * `formatChapterNumber()` pour que 12.50 s'écrive « 12,5 » et non « 13 ».
 */
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  PROGRESS_STATUS_LABELS,
  useProgressList,
  useSaveProgress,
  type ProgressEntry,
  type ProgressStatus,
} from '../api/progress'
import {
  advance,
  currentUnitOf,
  hasTotal,
  progressRatio,
  statusChangeInput,
  type ProgressTarget,
} from '../lib/progression'
import { formatChapterNumber, formatDate, type MediaKindFilter } from '../types/media'

/**
 * Ordre d'affichage des onglets, différent de `PROGRESS_STATUSES` (qui suit
 * l'ordre du contrat) : « en cours » d'abord parce que c'est l'onglet qu'on
 * vient consulter, les archives (« terminé », « abandonné ») à la fin.
 */
const TAB_STATUSES: ProgressStatus[] = ['WATCHING', 'PLANNED', 'COMPLETED', 'PAUSED', 'DROPPED']

/** Onglet « tout » compris, pour l'état de l'URL. */
type Tab = ProgressStatus | 'ALL'

const TABS: Tab[] = ['ALL', ...TAB_STATUSES]

const TAB_LABELS: Record<Tab, string> = {
  ALL: 'Tout',
  ...PROGRESS_STATUS_LABELS,
}

/** Message d'onglet vide. Renvoyer au catalogue est la seule suite utile. */
const EMPTY_MESSAGES: Record<Tab, string> = {
  ALL: 'Vous ne suivez encore aucun titre.',
  WATCHING: 'Aucun titre en cours.',
  PLANNED: 'Rien de prévu pour l’instant.',
  COMPLETED: 'Aucun titre terminé.',
  PAUSED: 'Aucun titre en pause.',
  DROPPED: 'Aucun titre abandonné.',
}

type SortKey = 'updated' | 'title' | 'score' | 'progress'

const SORT_LABELS: Record<SortKey, string> = {
  updated: 'Dernière mise à jour',
  title: 'Titre (A → Z)',
  score: 'Ma note',
  progress: 'Progression',
}

const KIND_OPTIONS: { value: MediaKindFilter; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'anime', label: 'Animes' },
  { value: 'manga', label: 'Mangas' },
]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as string[]).includes(value)
}

function isSortKey(value: string | null): value is SortKey {
  return value !== null && value in SORT_LABELS
}

function isKindFilter(value: string | null): value is MediaKindFilter {
  return value === 'all' || value === 'anime' || value === 'manga'
}

/**
 * Comparateur de tri.
 *
 * Les valeurs absentes vont systématiquement **en fin de liste**, quel que soit
 * le critère : une note non renseignée n'est pas une note de 0, et la remonter
 * en tête d'un tri « ma note » enterrerait les titres réellement notés.
 */
function comparator(sort: SortKey): (a: ProgressEntry, b: ProgressEntry) => number {
  switch (sort) {
    case 'title':
      return (a, b) => a.targetTitle.localeCompare(b.targetTitle, 'fr', { sensitivity: 'base' })

    case 'score':
      return (a, b) => nullsLast(a.score, b.score)

    case 'progress':
      return (a, b) => {
        // Le ratio est comparable entre œuvres ; le compteur brut ne l'est pas
        // (12 épisodes sur 12 n'est pas « moins avancé » que 12 sur 1 147).
        const ratioDiff = nullsLast(
          progressRatio(currentUnitOf(a), a.targetUnitCount),
          progressRatio(currentUnitOf(b), b.targetUnitCount),
        )
        if (ratioDiff !== 0) return ratioDiff
        // Sans total connu des deux côtés, le compteur reste le seul repère.
        return nullsLast(currentUnitOf(a), currentUnitOf(b))
      }

    case 'updated':
    default:
      return (a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
  }
}

/** Décroissant, `null` relégué en fin quel que soit le sens. */
function nullsLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

export function ListPage() {
  const { entries, isLoading, isError, error, refetch, isFetching } = useProgressList()
  const [params, setParams] = useSearchParams()

  // L'état vit dans l'URL : un onglet est alors partageable, et le retour
  // arrière du navigateur fait ce qu'on attend de lui après un clic d'onglet.
  const rawTab = params.get('statut')
  const tab: Tab = isTab(rawTab) ? rawTab : 'WATCHING'
  const rawKind = params.get('type')
  const kind: MediaKindFilter = isKindFilter(rawKind) ? rawKind : 'all'
  const rawSort = params.get('tri')
  const sort: SortKey = isSortKey(rawSort) ? rawSort : 'updated'

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: true })
  }

  const counts = useMemo(() => {
    const byTab = new Map<Tab, number>(TABS.map((value) => [value, 0]))
    for (const entry of entries) {
      byTab.set('ALL', (byTab.get('ALL') ?? 0) + 1)
      byTab.set(entry.status, (byTab.get(entry.status) ?? 0) + 1)
    }
    return byTab
  }, [entries])

  const inTab = useMemo(
    () => (tab === 'ALL' ? entries : entries.filter((entry) => entry.status === tab)),
    [entries, tab],
  )

  // Les compteurs de type se calculent **dans l'onglet courant** : « 3 animes »
  // sous l'onglet « en cours » doit parler de l'onglet, pas de toute la liste.
  const kindCounts = {
    all: inTab.length,
    anime: inTab.filter((entry) => entry.kind === 'anime').length,
    manga: inTab.filter((entry) => entry.kind === 'manga').length,
  }

  const visible = useMemo(() => {
    const filtered = kind === 'all' ? inTab : inTab.filter((entry) => entry.kind === kind)
    return [...filtered].sort(comparator(sort))
  }, [inTab, kind, sort])

  const animes = visible.filter((entry) => entry.kind === 'anime')
  const mangas = visible.filter((entry) => entry.kind === 'manga')

  return (
    <div className="catalog mylist">
      <header className="catalog__header">
        <h1 className="catalog__title">Ma liste</h1>
        <p className="catalog__subtitle">
          Votre suivi, par statut. Un clic sur <strong>+1</strong> avance d’un épisode ou d’un
          chapitre sans quitter la page.
        </p>
      </header>

      <div className="mylist__tabs" role="tablist" aria-label="Statut de progression">
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`mylist__tab ${tab === value ? 'is-active' : ''}`}
            onClick={() => update('statut', value)}
          >
            {TAB_LABELS[value]}
            <span className="segmented__count">{counts.get(value) ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="filters__row mylist__controls">
        <div className="segmented" role="group" aria-label="Type de média">
          {KIND_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`segmented__item ${kind === option.value ? 'is-active' : ''}`}
              aria-pressed={kind === option.value}
              onClick={() => update('type', option.value)}
            >
              {option.label} <span className="segmented__count">{kindCounts[option.value]}</span>
            </button>
          ))}
        </div>

        <label className="field field--inline">
          <span className="field__label">Trier par</span>
          <select
            className="select select--sm"
            value={sort}
            onChange={(event) => update('tri', event.target.value)}
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((value) => (
              <option key={value} value={value}>
                {SORT_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        {isFetching && !isLoading && <span className="muted">Actualisation…</span>}
      </div>

      {isLoading && <p className="muted">Chargement de votre liste…</p>}

      {isError && (
        <div className="panel panel--error" role="alert">
          <h2>Impossible de charger votre liste</h2>
          <p>{error instanceof Error ? error.message : 'Erreur inconnue'}</p>
          <button type="button" className="btn" onClick={() => void refetch()}>
            Réessayer
          </button>
        </div>
      )}

      {!isLoading && !isError && (
        <div role="tabpanel" aria-label={TAB_LABELS[tab]}>
          {visible.length === 0 ? (
            <EmptyTab tab={tab} kind={kind} hasAny={entries.length > 0} />
          ) : kind === 'all' ? (
            // Séparation explicite quand les deux types cohabitent : un anime et
            // un manga ne se comptent pas dans la même unité, et les mélanger
            // rend la colonne « progression » illisible.
            <>
              <Section title="Animes" entries={animes} />
              <Section title="Mangas" entries={mangas} />
            </>
          ) : (
            <ul className="mylist__list">
              {visible.map((entry) => (
                <li key={entry.targetIri}>
                  <ListRow entry={entry} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, entries }: { title: string; entries: ProgressEntry[] }) {
  if (entries.length === 0) return null

  return (
    <section className="mylist__section">
      <h2 className="section__title">
        {title}
        <span className="section__count">{entries.length}</span>
      </h2>
      <ul className="mylist__list">
        {entries.map((entry) => (
          <li key={entry.targetIri}>
            <ListRow entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function EmptyTab({ tab, kind, hasAny }: { tab: Tab; kind: MediaKindFilter; hasAny: boolean }) {
  // Distinguer « cet onglet est vide » de « ce type l'est » : envoyer au
  // catalogue quelqu'un qui a dix mangas en cours mais aucun anime serait à
  // côté de la question.
  const kindLabel = kind === 'anime' ? 'anime' : 'manga'

  return (
    <div className="panel">
      <h2>{kind === 'all' ? EMPTY_MESSAGES[tab] : `Aucun ${kindLabel} dans cet onglet.`}</h2>
      <p>
        {hasAny
          ? 'Changez d’onglet, ou ajoutez un titre depuis le catalogue : sa progression apparaîtra ici.'
          : 'Ouvrez une fiche du catalogue et renseignez votre progression — le titre viendra se ranger dans cette liste.'}
      </p>
      <Link to="/" className="btn btn--primary">
        Parcourir le catalogue
      </Link>
    </div>
  )
}

/**
 * Une ligne de la liste.
 *
 * Chaque ligne possède **sa** mutation plutôt que d'en partager une avec la
 * page : sans cela, `isPending` serait vrai partout à la fois et un échec sur
 * une ligne afficherait son erreur sur les cinquante autres.
 */
function ListRow({ entry }: { entry: ProgressEntry }) {
  const save = useSaveProgress()
  // La proposition « marquer comme terminé » est refusable : une fois écartée,
  // elle ne revient qu'au prochain « +1 », sinon elle harcèle.
  const [suggestCompletion, setSuggestCompletion] = useState(false)

  const isAnime = entry.kind === 'anime'
  const total = entry.targetUnitCount
  const current = currentUnitOf(entry)
  const ratio = progressRatio(current, total)

  const target: ProgressTarget = {
    targetIri: entry.targetIri,
    kind: entry.kind,
    total,
  }

  const next = advance(target, entry)
  const noun = isAnime ? 'épisode' : 'chapitre'

  const handleAdvance = () => {
    if (!next) return
    setSuggestCompletion(false)
    save.mutate(next.input, {
      // On relit la ressource renvoyée plutôt que de rejouer ce qu'on croit
      // avoir envoyé : le backend normalise (et peut donc corriger) le
      // compteur, et c'est sa valeur qui décide s'il reste quelque chose à
      // proposer.
      onSuccess: (saved) => {
        const stored = saved ?? null
        const reached = hasTotal(total) && (currentUnitOf(stored) ?? 0) >= total
        setSuggestCompletion(reached && stored?.status !== 'COMPLETED')
      },
    })
  }

  const handleStatus = (status: ProgressStatus) => {
    setSuggestCompletion(false)
    save.mutate(statusChangeInput(target, entry, status))
  }

  return (
    <article className={`mylist-row ${save.isPending ? 'is-pending' : ''}`}>
      <Link to={entry.href} className="mylist-row__cover" aria-hidden="true" tabIndex={-1}>
        {entry.targetCover ? (
          <img src={entry.targetCover} alt="" loading="lazy" />
        ) : (
          <span className="card__cover-fallback">
            {entry.targetTitle.slice(0, 2).toUpperCase()}
          </span>
        )}
      </Link>

      <div className="mylist-row__body">
        <Link to={entry.href} className="mylist-row__title">
          {entry.targetTitle}
        </Link>
        <span className="mylist-row__meta">
          <span className={`card__kind card__kind--${entry.kind}`}>
            {isAnime ? 'Anime' : 'Manga'}
          </span>
          {entry.updatedAt && <span className="muted">Modifié le {formatDate(entry.updatedAt)}</span>}
        </span>
      </div>

      <div className="mylist-row__progress">
        <span className="mylist-row__counter">
          {current === null ? '—' : formatChapterNumber(current)}
          <span className="muted"> / {hasTotal(total) ? total : '?'}</span>
        </span>
        {ratio !== null ? (
          <span
            className="progress-bar progress-bar--slim"
            role="img"
            aria-label={`${current ?? 0} ${noun}${(current ?? 0) > 1 ? 's' : ''} sur ${total}`}
          >
            <span className="progress-bar__fill" style={{ width: `${ratio * 100}%` }} />
          </span>
        ) : (
          // Pas de total chez AniList (fréquent sur les séries en cours) : une
          // barre sans échelle ne veut rien dire, on l'annonce plutôt.
          <span className="mylist-row__no-total muted">total inconnu</span>
        )}
      </div>

      <span className="mylist-row__score" title="Votre note, sur 100">
        {entry.score !== null ? (
          <>
            <strong>{entry.score}</strong>
            <span className="muted">/100</span>
          </>
        ) : (
          <span className="muted">non notée</span>
        )}
      </span>

      <div className="mylist-row__actions">
        <button
          type="button"
          className="btn btn--primary btn--sm mylist-row__plus"
          onClick={handleAdvance}
          disabled={next === null || save.isPending}
          title={
            next === null
              ? `Vous êtes au dernier ${noun} référencé (${total}).`
              : `Passer au ${noun} ${formatChapterNumber(next.unit)}`
          }
        >
          +1 <span className="visually-hidden">{noun}</span>
        </button>

        <label className="mylist-row__status">
          <span className="visually-hidden">Statut de « {entry.targetTitle} »</span>
          <select
            className="select select--sm"
            value={entry.status}
            disabled={save.isPending}
            onChange={(event) => handleStatus(event.target.value as ProgressStatus)}
          >
            {TAB_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PROGRESS_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {suggestCompletion && (
        <div className="notice notice--suggest mylist-row__notice" role="status">
          <span>
            Vous êtes au dernier {noun} ({total}). Marquer comme terminé ?
          </span>
          <span className="notice__actions">
            <button
              type="button"
              className="btn btn--sm btn--primary"
              onClick={() => handleStatus('COMPLETED')}
            >
              Marquer comme terminé
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => setSuggestCompletion(false)}
            >
              Non merci
            </button>
          </span>
        </div>
      )}

      {save.isError && (
        <p className="form__error mylist-row__error" role="alert">
          {save.error instanceof Error ? save.error.message : 'La mise à jour a échoué.'}
        </p>
      )}
    </article>
  )
}
