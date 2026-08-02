/**
 * Validation et étiquetage des URL sortantes.
 *
 * Séparé de `components/ExternalLink.tsx` parce que ce sont des fonctions pures,
 * testables sans DOM — et parce qu'un module qui exporte à la fois un composant
 * et des utilitaires casse le Fast Refresh de Vite (règle
 * `react(only-export-components)`, lint bloquant en CI).
 */

/**
 * Valide une URL venue du backend avant de la mettre dans un `href`.
 *
 * Les `streamUrl` / `readUrl` proviennent de l'import AniList, donc d'une
 * source externe : une valeur `javascript:…` ou `data:…` recopiée telle quelle
 * dans un `href` s'exécuterait dans notre origine. Seuls `http` et `https`
 * passent.
 *
 * @returns l'URL normalisée, ou `null` pour une chaîne vide, une URL relative
 *          ou un schéma exécutable.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    // URL relative ou syntaxe invalide : pas un lien sortant.
    return null
  }
}

/**
 * Hôtes reconnus, pour écrire « Regarder sur Crunchyroll » plutôt qu'un « Voir »
 * qui ne dit pas où l'on part. La quasi-totalité des liens importés pointent
 * aujourd'hui sur Crunchyroll ; les autres entrées coûtent une ligne et évitent
 * un domaine nu si la source d'import s'élargit.
 */
const KNOWN_HOSTS: ReadonlyArray<[RegExp, string]> = [
  [/(^|\.)crunchyroll\.com$/i, 'Crunchyroll'],
  [/(^|\.)animationdigitalnetwork\.(fr|com)$/i, 'ADN'],
  [/(^|\.)netflix\.com$/i, 'Netflix'],
  [/(^|\.)primevideo\.com$/i, 'Prime Video'],
  [/(^|\.)wakanim\.tv$/i, 'Wakanim'],
  [/(^|\.)mangadex\.org$/i, 'MangaDex'],
]

/**
 * Nom lisible du service derrière une URL. Les hôtes inconnus retombent sur le
 * domaine nu (« Regarder sur exemple.tv »), ce qui reste honnête sans exiger un
 * annuaire exhaustif. `null` si l'URL n'est pas exploitable.
 */
export function externalProviderName(url: string | null | undefined): string | null {
  const safe = safeExternalUrl(url)
  if (!safe) return null

  const host = new URL(safe).hostname
  for (const [pattern, name] of KNOWN_HOSTS) {
    if (pattern.test(host)) return name
  }
  return host.replace(/^www\./i, '')
}
