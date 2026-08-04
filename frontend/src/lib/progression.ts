/**
 * Règles de progression, extraites des composants pour être testables.
 *
 * Elles étaient auparavant enfouies dans `UnitList.tsx` ; « Ma liste » a besoin
 * exactement des mêmes, et deux copies auraient dérivé au premier ajustement.
 *
 * ── Ce que fait le backend, et qu'on ne réimplémente pas ───────────────────
 * `App\State\ProgressCompletionProvider` **normalise** un `COMPLETED` dont le
 * compteur est trop bas : il le porte au total de l'œuvre et renvoie la valeur
 * corrigée dans la réponse. Ce n'est donc pas un 422 et la seule vérité est la
 * réponse — `useSaveProgress` la relit et l'écrit dans le cache.
 *
 * `normalizeCompletion()` ci-dessous est le *miroir* de cette règle, à une fin
 * unique : afficher tout de suite ce que le serveur va enregistrer, plutôt
 * qu'un « Terminé, 1/25 » qui se corrigerait une seconde plus tard. Rien ici ne
 * fait autorité.
 *
 * `App\Validator\CoherentProgress` rejette en revanche (422) un compteur qui
 * dépasse le total. D'où les bornages : on n'envoie jamais volontairement une
 * valeur qu'on sait invalide.
 *
 * ── Typage ────────────────────────────────────────────────────────────────
 * `Progress.currentChapter` est un `decimal(8,2)` sérialisé en **string** JSON.
 * Tout ce module travaille sur des nombres déjà passés par `parseDecimal()` ;
 * la re-sérialisation est le travail de `toDecimalString()`.
 */
import type { ProgressEntry, ProgressInput, ProgressStatus } from '../api/progress'
import type { MediaKind } from '../types/media'

/** L'œuvre visée, réduite à ce dont les règles ont besoin. */
export type ProgressTarget = {
  /** IRI de l'anime ou du manga, p. ex. "/api/animes/12". */
  targetIri: string
  kind: MediaKind
  /**
   * Total annoncé par le catalogue (`episodeCount` / `chapterCount`).
   * `null` très souvent : AniList ne le remplit pas pour les séries en cours —
   * One Piece n'en a aucun.
   */
  total: number | null
}

/**
 * Vrai quand le total est exploitable.
 *
 * `> 0` autant que `!== null` : un total à zéro est une donnée d'import
 * dégradée, pas une œuvre sans épisode, et borner une progression à 0 serait
 * absurde.
 */
export function hasTotal(total: number | null | undefined): total is number {
  return typeof total === 'number' && Number.isFinite(total) && total > 0
}

/** La progression courante d'une entrée, quel que soit le type de média. */
export function currentUnitOf(entry: ProgressEntry | null | undefined): number | null {
  if (!entry) return null
  return (entry.kind === 'anime' ? entry.currentEpisode : entry.currentChapter) ?? null
}

/**
 * Miroir de la normalisation serveur : ce que vaudra le compteur une fois
 * enregistré. Sans total connu, ou hors `COMPLETED`, la valeur est inchangée.
 */
export function normalizeCompletion(
  status: ProgressStatus,
  current: number | null,
  total: number | null,
): number | null {
  if (status !== 'COMPLETED') return current
  if (!hasTotal(total)) return current
  if (current === null || current < total) return total
  return current
}

/**
 * Avancement affiché, entre 0 et 1. `null` quand le total est inconnu : une
 * barre sans échelle ne veut rien dire et il vaut mieux ne pas en dessiner.
 */
export function progressRatio(current: number | null, total: number | null): number | null {
  if (!hasTotal(total)) return null
  return Math.max(0, Math.min(1, (current ?? 0) / total))
}

/**
 * Répartit un compteur sur le bon champ du contrat.
 *
 * `currentEpisode` n'a de sens que sur un anime, `currentChapter` que sur un
 * manga — l'API renvoie 422 sur le mauvais couple.
 */
function unitFields(kind: MediaKind, unit: number | null) {
  return {
    currentEpisode: kind === 'anime' ? unit : null,
    currentChapter: kind === 'manga' ? unit : null,
  }
}

/**
 * Statut après un geste d'avancement, sans jamais écraser une décision de
 * l'utilisateur : la promotion en `WATCHING` ne part que de « prévu » ou de
 * rien. Un titre marqué `DROPPED` ou `PAUSED` garde son statut — avancer d'un
 * épisode n'est pas dire « j'ai repris », et la ligne resterait sinon
 * introuvable dans l'onglet où l'utilisateur l'a rangée.
 */
function statusAfterAdvance(previous: ProgressStatus | null): ProgressStatus {
  if (previous === null || previous === 'PLANNED') return 'WATCHING'
  return previous
}

/** Ce que « +1 » produirait, ou `null` quand il n'y a plus rien à ajouter. */
export type Advance = {
  /** Compteur visé. */
  unit: number
  status: ProgressStatus
  /** Le total est connu et atteint par ce geste. */
  reachesTotal: boolean
  /** Total atteint alors que le statut n'est pas (encore) « Terminé ». */
  suggestsCompletion: boolean
  input: ProgressInput
}

/**
 * Le geste le plus fréquent d'un tracker : un épisode / chapitre de plus.
 *
 * Renvoie `null` quand la progression est déjà au total connu — il n'y a alors
 * rien à envoyer, et insister vaudrait un 422 (`CoherentProgress` refuse de
 * dépasser le total).
 *
 * Sur un manga, on repart de la **partie entière** : depuis 12,5 le chapitre
 * suivant est le 13, pas le 13,5.
 */
export function advance(
  target: ProgressTarget,
  entry: ProgressEntry | null,
  step = 1,
): Advance | null {
  const current = currentUnitOf(entry)
  const base = current === null ? 0 : Math.floor(current)
  const next = base + step

  if (hasTotal(target.total) && current !== null && current >= target.total) return null

  const unit = hasTotal(target.total) ? Math.min(next, target.total) : next
  const status = statusAfterAdvance(entry?.status ?? null)
  const reachesTotal = hasTotal(target.total) && unit >= target.total

  return {
    unit,
    status,
    reachesTotal,
    // Volontairement une *proposition* : abandonner une série à son dernier
    // épisode est un cas réel, et décider à la place de l'utilisateur ferait
    // basculer la ligne d'onglet sans qu'il l'ait demandé.
    suggestsCompletion: reachesTotal && status !== 'COMPLETED',
    input: {
      targetIri: target.targetIri,
      kind: target.kind,
      status,
      ...unitFields(target.kind, unit),
      score: entry?.score ?? null,
      existing: entry,
    },
  }
}

/**
 * Changement de statut seul, depuis une ligne de liste.
 *
 * Le compteur suit la normalisation « Terminé ⟹ total » pour que la ligne
 * affiche immédiatement ce que le serveur va enregistrer. Quitter `COMPLETED`
 * ne redescend en revanche **rien** : avoir tout vu reste vrai après être passé
 * en « abandonné ».
 */
export function statusChangeInput(
  target: ProgressTarget,
  entry: ProgressEntry | null,
  status: ProgressStatus,
): ProgressInput {
  const unit = normalizeCompletion(status, currentUnitOf(entry), target.total)

  return {
    targetIri: target.targetIri,
    kind: target.kind,
    status,
    ...unitFields(target.kind, unit),
    score: entry?.score ?? null,
    existing: entry,
  }
}

/**
 * Construit la mise à jour déclenchée par un clic sur « vu » dans la liste des
 * épisodes / chapitres d'une fiche.
 *
 * Deux règles, en plus de `statusAfterAdvance` :
 *  - `COMPLETED` n'est posé que si le total est connu **et** atteint. Sans
 *    total fiable, on ne devine pas.
 *  - décocher ramène juste avant l'unité visée, seule interprétation non
 *    destructrice : remettre à zéro perdrait tout l'historique sur un clic mal
 *    placé. Et comme reculer sous le total rendrait un `COMPLETED` incohérent
 *    — un 422 en pleine figure depuis que le backend valide la règle — le
 *    statut redescend alors à « en cours », ce que le geste veut dire.
 */
export function markUpToInput(
  target: ProgressTarget,
  entry: ProgressEntry | null,
  unitValue: number,
  seen: boolean,
): ProgressInput {
  const unit = seen ? Math.max(0, unitValue - 1) : unitValue
  const reached = hasTotal(target.total) && unit >= target.total
  const previous = entry?.status ?? null
  const leavesCompleted = previous === 'COMPLETED' && !reached

  const status: ProgressStatus =
    reached && !seen ? 'COMPLETED' : leavesCompleted ? 'WATCHING' : statusAfterAdvance(previous)

  return {
    targetIri: target.targetIri,
    kind: target.kind,
    status,
    // `0` est légitime après un décochage du tout premier épisode ; `null`
    // voudrait dire « non renseigné », ce qui n'est pas la même chose.
    ...unitFields(target.kind, unit),
    score: entry?.score ?? null,
    existing: entry,
  }
}
