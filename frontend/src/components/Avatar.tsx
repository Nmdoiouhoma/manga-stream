import { avatarColors, initialsOf } from '../lib/avatar'

/**
 * Pastille d'identité : les initiales d'un compte sur sa couleur.
 *
 * Purement décoratif au sens de l'accessibilité — le pseudo est **toujours**
 * écrit à côté, dans le profil comme dans un commentaire. La pastille est donc
 * masquée aux lecteurs d'écran (`aria-hidden`), qui annonceraient sinon deux
 * fois la même personne, la seconde fois épelée en initiales.
 *
 * La couleur est dérivée du pseudo, jamais stockée : voir `lib/avatar.ts`.
 */
export function Avatar({
  name,
  size = 'md',
}: {
  name: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const colors = avatarColors(name)

  return (
    <span
      className={`avatar avatar--${size}`}
      aria-hidden="true"
      style={{
        backgroundColor: colors.background,
        borderColor: colors.border,
        color: colors.text,
      }}
    >
      {initialsOf(name)}
    </span>
  )
}
