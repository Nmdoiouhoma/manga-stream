/**
 * Liste des épisodes (anime) et des chapitres (manga) d'une fiche.
 *
 * ── Ce composant est écrit pour des données lacunaires ────────────────────
 * L'import AniList ne remplit pas tout : au 2026-08-02 les tables `episode` et
 * `chapter` sont encore **vides** (0 et 0, vérifié en base), et l'import en
 * cours ne fournira ni titre ni vignette ni date pour tout le monde — AniList
 * expose très mal les chapitres de manga. Chaque champ est donc traité comme
 * absent par défaut :
 *   - pas de titre    → « Épisode 12 » / « Chapitre 12,5 », construit du numéro
 *   - pas de vignette → pastille typographique, jamais un `<img>` cassé
 *   - pas de date     → le séparateur disparaît avec elle (pas de « · » orphelin)
 *   - pas de durée    → idem
 *   - liste vide      → message qui distingue « aucun épisode annoncé » de
 *                       « N annoncés, aucun encore importé »
 *
 * ── Pagination ────────────────────────────────────────────────────────────
 * Certains titres dépassent le millier d'épisodes (One Piece). Rendre mille
 * lignes fige l'onglet, et un « afficher plus » forcerait 40 clics pour
 * atteindre la fin. La liste est donc découpée en tranches avec un sélecteur
 * de plage, ce qui rend n'importe quel épisode atteignable en deux gestes.
 *
 * ── Liens de visionnage ───────────────────────────────────────────────────
 * 1 795 des 4 392 épisodes en base portent un `streamUrl` officiel importé
 * d'AniList (Crunchyroll, essentiellement). La couverture est très inégale :
 * totale sur Death Note ou Fullmetal Alchemist, **69 liens sur 1 147** pour
 * One Piece. Deux conséquences assumées ici :
 *   - une ligne sans lien n'affiche rien du tout (pas de bouton grisé : la
 *     donnée est absente chez AniList, ce n'est pas une panne) ;
 *   - quand la couverture est partielle, un filtre « disponibles en ligne »
 *     évite d'avoir à parcourir 23 tranches pour trouver les 69 épisodes
 *     regardables.
 *
 * ── Typage ────────────────────────────────────────────────────────────────
 * `Episode.number` est un `integer`. `Chapter.number` est un `decimal(8,2)`
 * sérialisé en **string** JSON ("12.50") — jamais un nombre. Tout calcul passe
 * par `parseDecimal()` et tout affichage par `formatChapterNumber()`.
 */
import { useMemo, useState } from 'react'
import { useMediaProgress, useSaveProgress, type ProgressEntry } from '../api/progress'
import { useAuth } from '../auth/useAuth'
import { ExternalLink } from './ExternalLink'
import { externalProviderName, safeExternalUrl } from '../lib/externalUrl'
import {
  formatChapterNumber,
  formatDate,
  parseDecimal,
  type Chapter,
  type Episode,
  type MediaDetail,
} from '../types/media'

/** Au-delà, la liste est découpée en tranches. */
const CHUNK_SIZE = 50

/** Forme commune à un épisode et à un chapitre, pour un rendu unique. */
type Unit = {
  key: string
  /** Valeur numérique, pour comparer à la progression. */
  value: number
  /** Numéro affichable ("12", "12,5"). */
  label: string
  title: string | null
  thumbnail: string | null
  /** « 24 min » ou « 18 p. ». `null` si le champ manque. */
  metric: string | null
  date: string | null
  /**
   * Lien sortant (visionnage / lecture) validé : `null` dès que l'URL est
   * absente ou n'est pas en http(s).
   */
  externalUrl: string | null
  /** Nom du service, « Crunchyroll » le plus souvent. `null` sans lien. */
  provider: string | null
}

function episodeToUnit(episode: Episode): Unit {
  return {
    key: episode['@id'],
    value: episode.number,
    label: String(episode.number),
    title: episode.title?.trim() || null,
    thumbnail: episode.thumbnail?.trim() || null,
    metric: episode.duration ? `${episode.duration} min` : null,
    date: formatDate(episode.airDate),
    externalUrl: safeExternalUrl(episode.streamUrl),
    provider: externalProviderName(episode.streamUrl),
  }
}

function chapterToUnit(chapter: Chapter): Unit {
  // `number` arrive en string ; `parseDecimal` tolère aussi la virgule.
  const value = parseDecimal(chapter.number, Number.NaN)
  return {
    key: chapter['@id'],
    value: Number.isFinite(value) ? value : 0,
    label: formatChapterNumber(chapter.number),
    title: chapter.title?.trim() || null,
    thumbnail: null, // Le contrat n'expose pas de vignette de chapitre.
    metric: chapter.pageCount ? `${chapter.pageCount} p.` : null,
    date: formatDate(chapter.releaseDate),
    externalUrl: safeExternalUrl(chapter.readUrl),
    provider: externalProviderName(chapter.readUrl),
  }
}

export function UnitList({ media }: { media: MediaDetail }) {
  const isAnime = media.kind === 'anime'
  const { isAuthenticated } = useAuth()
  const { entry } = useMediaProgress(media.iri)
  const save = useSaveProgress()

  const units = useMemo(
    () =>
      isAnime ? media.episodes.map(episodeToUnit) : media.chapters.map(chapterToUnit),
    [isAnime, media.episodes, media.chapters],
  )

  // Combien portent un lien sortant exploitable. Calculé sur la liste
  // **complète**, pas sur la tranche visible : « 69 épisodes disponibles » doit
  // parler du titre, pas de la page en cours.
  const onlineCount = useMemo(
    () => units.filter((unit) => unit.externalUrl !== null).length,
    [units],
  )
  const [onlineOnly, setOnlineOnly] = useState(false)
  // Le filtre ne peut rester actif s'il ne reste rien à filtrer (changement de
  // fiche sans démontage du composant) : sinon la liste paraîtrait vide.
  const filterActive = onlineOnly && onlineCount > 0
  const shown = useMemo(
    () => (filterActive ? units.filter((unit) => unit.externalUrl !== null) : units),
    [filterActive, units],
  )

  const chunks = useMemo(() => chunk(shown, CHUNK_SIZE), [shown])
  const [page, setPage] = useState(0)
  // La liste peut rétrécir entre deux rendus (navigation, refetch, filtre) :
  // borner l'index évite d'afficher une tranche vide sans jamais le dire.
  const safePage = Math.min(page, Math.max(0, chunks.length - 1))
  const visible = chunks[safePage] ?? []

  const heading = isAnime ? 'Épisodes' : 'Chapitres'
  const noun = isAnime ? 'épisode' : 'chapitre'
  const current = (isAnime ? entry?.currentEpisode : entry?.currentChapter) ?? null

  return (
    <section className="panel">
      <div className="unit-head">
        <h2 className="section__title">
          {heading}
          {units.length > 0 && <span className="section__count">{units.length}</span>}
        </h2>

        {chunks.length > 1 && (
          <label className="unit-range">
            <span className="visually-hidden">Plage affichée</span>
            <select
              className="select select--sm"
              value={safePage}
              onChange={(event) => setPage(Number(event.target.value))}
            >
              {chunks.map((slice, index) => (
                <option key={index} value={index}>
                  {slice[0]?.label ?? '?'} – {slice[slice.length - 1]?.label ?? '?'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {onlineCount > 0 && (
        <div className="unit-online">
          <p className="unit-online__count">
            <strong>{onlineCount}</strong> {noun}
            {onlineCount > 1 ? 's' : ''} disponible{onlineCount > 1 ? 's' : ''} en ligne
            {/* Le rapport n'est affiché que s'il apprend quelque chose : sur un
                titre couvert à 100 %, « 64 sur 64 » est du bruit. */}
            {onlineCount < units.length && <span className="muted"> sur {units.length}</span>}
          </p>

          {/* Le filtre n'a de sens qu'en couverture partielle. Sur One Piece il
              fait passer de 23 tranches à 2. */}
          {onlineCount < units.length && (
            <label className="unit-online__filter">
              <input
                type="checkbox"
                checked={onlineOnly}
                onChange={(event) => {
                  setOnlineOnly(event.target.checked)
                  // La tranche 12 n'existe plus une fois filtré : repartir du début.
                  setPage(0)
                }}
              />
              <span>Uniquement ceux disponibles en ligne</span>
            </label>
          )}
        </div>
      )}

      {units.length === 0 ? (
        <EmptyUnits isAnime={isAnime} announced={media.unitCount} />
      ) : (
        <>
          <ul className="unit-list">
            {visible.map((unit) => (
              <UnitRow
                key={unit.key}
                unit={unit}
                isAnime={isAnime}
                // « Vu » vaut pour tout ce qui précède : une progression à
                // l'épisode 12 signifie que le 5 l'est aussi.
                seen={current !== null && current >= unit.value}
                canMark={isAuthenticated}
                pending={save.isPending}
                onMark={() =>
                  save.mutate(
                    markInput(media, entry, unit, current !== null && current >= unit.value),
                  )
                }
              />
            ))}
          </ul>

          {chunks.length > 1 && (
            <nav className="unit-pager" aria-label={`Pagination des ${heading.toLowerCase()}`}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setPage(safePage - 1)}
                disabled={safePage === 0}
              >
                Précédents
              </button>
              <span className="muted">
                {safePage + 1} / {chunks.length}
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= chunks.length - 1}
              >
                Suivants
              </button>
            </nav>
          )}

          {save.isError && (
            <p className="form__error" role="alert">
              {save.error instanceof Error
                ? save.error.message
                : 'Impossible d’enregistrer la progression.'}
            </p>
          )}
        </>
      )}
    </section>
  )
}

function UnitRow({
  unit,
  isAnime,
  seen,
  canMark,
  pending,
  onMark,
}: {
  unit: Unit
  isAnime: boolean
  seen: boolean
  canMark: boolean
  pending: boolean
  onMark: () => void
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const showThumb = Boolean(unit.thumbnail) && !imageFailed
  const fallbackTitle = `${isAnime ? 'Épisode' : 'Chapitre'} ${unit.label}`
  const verb = isAnime ? 'Regarder' : 'Lire'

  // Assemblé plutôt que concaténé : sans ça, une durée absente laisserait un
  // « · » en tête de ligne, et deux champs absents une chaîne de séparateurs.
  const meta = [unit.metric, unit.date].filter((part): part is string => Boolean(part)).join(' · ')

  return (
    <li className={`unit ${seen ? 'is-seen' : ''}`}>
      <span className="unit__number">{unit.label}</span>

      {isAnime && (
        <span className="unit__thumb">
          {showThumb ? (
            <img
              src={unit.thumbnail ?? ''}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          ) : (
            // Pas de vignette : une pastille neutre, pas un `<img>` cassé.
            <span className="unit__thumb-fallback" aria-hidden="true">
              {unit.label}
            </span>
          )}
        </span>
      )}

      <span className="unit__title" title={unit.title ?? fallbackTitle}>
        {unit.title ?? fallbackTitle}
      </span>

      {/* Rendu conditionnel plutôt qu'une chaîne vide : un <span> vide occupe
          quand même sa colonne de grille et décale toute la ligne. */}
      {meta !== '' && <span className="unit__meta">{meta}</span>}

      <span className="unit__actions">
        {/* « Regarder » est réservé aux vrais liens sortants : ailleurs dans
            l'app l'action est un suivi, pas un visionnage. `ExternalLink` ne
            rend rien quand l'URL est absente ou non http(s). */}
        <ExternalLink
          className="unit__external"
          href={unit.externalUrl}
          label={`${verb} ${isAnime ? 'l’épisode' : 'le chapitre'} ${unit.label} sur ${
            unit.provider ?? 'le site externe'
          } — nouvel onglet`}
        >
          <span className="unit__external-text">
            {verb} sur {unit.provider}
          </span>
        </ExternalLink>

        {canMark && (
          <button
            type="button"
            className={`unit__mark ${seen ? 'is-seen' : ''}`}
            onClick={onMark}
            disabled={pending}
            aria-pressed={seen}
            title={
              seen
                ? `Revenir juste avant ${isAnime ? 'cet épisode' : 'ce chapitre'}`
                : `Marquer comme ${isAnime ? 'vu' : 'lu'} jusqu’ici`
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5 10 17.5 19 7" />
            </svg>
            <span className="visually-hidden">
              {seen ? 'Annuler' : isAnime ? 'Marquer comme vu' : 'Marquer comme lu'}
            </span>
          </button>
        )}
      </span>
    </li>
  )
}

/**
 * Construit la mise à jour de `Progress` déclenchée par un clic sur « vu ».
 *
 * Deux règles, pour ne jamais écraser une décision de l'utilisateur :
 *  - le statut n'est promu en `WATCHING` que depuis « prévu » ou depuis rien.
 *    Un titre marqué `DROPPED` ou `PAUSED` garde son statut : cocher un
 *    épisode n'est pas dire « j'ai repris ».
 *  - `COMPLETED` n'est posé que si le total est connu et atteint. Sans total
 *    fiable (`unitCount` vient d'AniList et peut manquer), on ne devine pas.
 *
 * Décocher ramène juste avant l'unité visée, ce qui est la seule
 * interprétation non destructrice : remettre à zéro perdrait tout l'historique
 * sur un clic mal placé.
 */
function markInput(
  media: MediaDetail,
  entry: ProgressEntry | null,
  unit: Unit,
  seen: boolean,
) {
  const isAnime = media.kind === 'anime'
  const target = seen ? Math.max(0, unit.value - 1) : unit.value
  const total = media.unitCount

  const reached = total !== null && total > 0 && target >= total
  const previousStatus = entry?.status ?? null
  const status =
    reached && !seen
      ? ('COMPLETED' as const)
      : previousStatus === null || previousStatus === 'PLANNED'
        ? ('WATCHING' as const)
        : previousStatus

  return {
    targetIri: media.iri,
    kind: media.kind,
    status,
    // `0` est une valeur légitime après un décochage du tout premier épisode ;
    // `null` voudrait dire « non renseigné », ce qui n'est pas la même chose.
    currentEpisode: isAnime ? target : null,
    currentChapter: isAnime ? null : target,
    score: entry?.score ?? null,
    existing: entry,
  }
}

function EmptyUnits({ isAnime, announced }: { isAnime: boolean; announced: number | null }) {
  const noun = isAnime ? 'épisode' : 'chapitre'

  if (announced && announced > 0) {
    return (
      <p className="muted">
        {announced} {noun}
        {announced > 1 ? 's' : ''} annoncé{announced > 1 ? 's' : ''} par la fiche, mais aucun n’est
        encore référencé dans la base — l’import est en cours côté backend.
      </p>
    )
  }

  return <p className="muted">Aucun {noun} référencé pour ce titre.</p>
}

/** Découpe en tranches de `size`. Une liste vide donne zéro tranche. */
function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return []
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}
