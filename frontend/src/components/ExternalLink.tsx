/**
 * Lien sortant — le seul endroit du front qui fabrique un `target="_blank"`.
 *
 * ── Pourquoi un composant plutôt qu'une balise ────────────────────────────
 * Deux invariants doivent tenir sur *chaque* lien externe, et un oubli ne se
 * voit pas à l'écran :
 *
 *  1. `rel="noopener noreferrer"`. Sans `noopener`, la page ouverte reçoit un
 *     `window.opener` utilisable : elle peut réécrire l'onglet d'origine
 *     (`opener.location = …`) et y afficher ce qu'elle veut, y compris une
 *     fausse page de connexion. Les navigateurs récents impliquent `noopener`
 *     pour `target="_blank"`, mais ce n'est pas universel et le coût est nul.
 *  2. Le `href` est validé (`safeExternalUrl`) : l'URL vient de l'import
 *     AniList, donc d'une source externe.
 *
 * Centraliser les deux garantit qu'un futur lien sortant les hérite.
 */
import { safeExternalUrl } from '../lib/externalUrl'

/** Chevron sortant, purement décoratif : le texte porte déjà l'information. */
export function ExternalIcon() {
  return (
    <svg className="external-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

type Props = {
  /** URL brute ; le composant ne rend rien si elle n'est pas en http(s). */
  href: string | null | undefined
  /** Libellé visible. */
  children: React.ReactNode
  className?: string
  /**
   * Nom accessible complet. Dans une liste de cinquante lignes, cinquante
   * « Regarder sur Crunchyroll » identiques n'aident personne au lecteur
   * d'écran : on y met « Regarder l'épisode 12 sur Crunchyroll ».
   */
  label?: string
}

export function ExternalLink({ href, children, className, label }: Props) {
  const safe = safeExternalUrl(href)
  // Pas d'URL exploitable → **rien**, jamais un bouton désactivé : un lien grisé
  // laisserait croire à une panne alors que la donnée n'existe simplement pas
  // chez AniList.
  if (!safe) return null

  return (
    <a
      className={className}
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
    >
      {children}
      <ExternalIcon />
    </a>
  )
}
