/**
 * Avatars déduits du pseudo : des initiales sur une couleur stable.
 *
 * ── Pourquoi pas d'upload ─────────────────────────────────────────────────
 * Une photo de profil suppose une colonne, une migration, un volume Docker
 * partagé entre le backend et nginx, une route dédiée dans Caddy, une
 * validation de type et de taille, et une place dans la stratégie de
 * sauvegarde — qui ne couvre aujourd'hui que `pg_dump`. Rien de tout cela
 * n'existe, et la machine de production tient dans 908 Mo. Un avatar dérivé du
 * pseudo donne le même repère visuel pour zéro octet stocké.
 *
 * ── Stable, et c'est tout l'intérêt ───────────────────────────────────────
 * La couleur vient d'un hachage du pseudo : le même compte a la même pastille
 * sur toutes les pages, dans tous les navigateurs, sans que rien ne soit
 * persisté nulle part. Deux pseudos voisins (`nakib` / `nakib2`) tombent sur
 * des teintes éloignées, ce qu'un simple « première lettre » ne ferait pas.
 *
 * Sans React : c'est de la manipulation de chaînes, elle se teste directement.
 */

/** Séparateurs à partir desquels on considère un nouveau « mot ». */
const WORD_BOUNDARY = /[\s._\-–—]+/

/**
 * Une ou deux lettres représentant le pseudo.
 *
 * `Array.from` et non `slice` : un pseudo peut commencer par un emoji ou une
 * lettre hors du plan multilingue de base, et couper à l'unité de code
 * produirait un demi-caractère.
 */
export function initialsOf(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return '?'

  const words = trimmed.split(WORD_BOUNDARY).filter(Boolean)

  if (words.length >= 2) {
    return (firstCharOf(words[0]) + firstCharOf(words[1])).toLocaleUpperCase()
  }

  return Array.from(trimmed).slice(0, 2).join('').toLocaleUpperCase()
}

function firstCharOf(word: string): string {
  return Array.from(word)[0] ?? ''
}

/**
 * Teinte HSL, dans `[0, 360[`.
 *
 * FNV-1a 32 bits : court, sans dépendance, et surtout il disperse bien les
 * chaînes proches — deux pseudos ne différant que par leur dernier caractère
 * n'ont aucune raison de se ressembler à l'écran.
 *
 * Ce n'est pas une fonction de hachage cryptographique et n'a pas à l'être :
 * rien de secret n'en dépend, le pseudo est public.
 */
export function hueOf(name: string): number {
  let hash = 0x811c9dc5

  for (const codePoint of Array.from(name.trim().toLocaleLowerCase())) {
    hash ^= codePoint.codePointAt(0) ?? 0
    // Multiplication FNV, en arithmétique 32 bits non signée.
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash % 360
}

export type AvatarColors = {
  background: string
  /** Bordure légèrement plus vive : la pastille se détache du fond sombre. */
  border: string
  text: string
}

/**
 * Saturation et luminosité fixes, seule la teinte varie. C'est ce qui fait que
 * les pastilles se ressemblent sans se confondre, et que le contraste du texte
 * reste tenu quelle que soit la teinte tirée — ce qui ne serait pas le cas si
 * la luminosité bougeait elle aussi.
 */
export function avatarColors(name: string): AvatarColors {
  const hue = hueOf(name)

  return {
    background: `hsl(${hue} 42% 32%)`,
    border: `hsl(${hue} 52% 46%)`,
    text: `hsl(${hue} 70% 90%)`,
  }
}
