/**
 * Lecture et mise en forme de l'en-tête `Retry-After`.
 *
 * Isolé des modules d'API parce que trois d'entre eux en ont besoin (connexion,
 * inscription, réinitialisation de mot de passe) et que ce sont des fonctions
 * pures, sans dépendance au client HTTP.
 */

/**
 * `Retry-After` a deux formes légales (RFC 9110) : un nombre de secondes, ou
 * une date HTTP. Les deux sont acceptées ; tout le reste donne `null` plutôt
 * qu'un `NaN` qui finirait affiché à l'utilisateur.
 */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const raw = header.trim()
  if (raw === '') return null

  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw)
    return Number.isFinite(seconds) ? seconds : null
  }

  const date = Date.parse(raw)
  if (Number.isNaN(date)) return null
  // Un délai déjà passé (horloges désynchronisées) vaut « réessayez maintenant ».
  return Math.max(0, Math.round((date - Date.now()) / 1000))
}

/** « 45 secondes », « 2 minutes » — un délai brut en secondes se lit mal. */
export function formatRetryDelay(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, seconds)} seconde${seconds > 1 ? 's' : ''}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes > 1 ? 's' : ''}`
}

/**
 * Phrase à afficher pour un 429.
 *
 * Le délai n'est annoncé que si le serveur l'a donné : inventer « réessayez
 * dans une minute » quand on n'en sait rien produirait un deuxième refus.
 */
export function rateLimitMessage(seconds: number | null, action = ''): string {
  const what = action.trim() === '' ? 'Trop de tentatives' : `Trop de tentatives ${action.trim()}`
  const when =
    seconds !== null ? `Réessayez dans ${formatRetryDelay(seconds)}.` : 'Réessayez dans quelques minutes.'
  return `${what}. ${when}`
}
