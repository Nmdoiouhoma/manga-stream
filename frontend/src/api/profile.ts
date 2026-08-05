/**
 * Modification de son propre compte.
 *
 * ── Le piège de l'adresse e-mail ──────────────────────────────────────────
 * L'identifiant de connexion **est** l'adresse (`security.yaml`,
 * `property: email`). Un jeton émis pour l'ancienne adresse ne désigne donc
 * plus personne dès qu'elle change : la requête suivante part en 401 et
 * l'application se déconnecte toute seule, juste après une modification
 * pourtant réussie.
 *
 * Vérifié côté backend plutôt que supposé — voir
 * `ProfileUpdateTest::testChangingTheEmailInvalidatesTheCurrentToken()`.
 *
 * Le hook signale donc le cas (`requiresReauthentication`) au lieu de le
 * subir : l'appelant peut prévenir puis rediriger vers la connexion, ce qui
 * est très différent d'une déconnexion inexpliquée.
 *
 * ── Pourquoi email et username partent toujours ensemble ──────────────────
 * Le contrat type le corps du merge-patch avec `email` et `username`
 * obligatoires. Les envoyer tous les deux, inchangés compris, est sans effet
 * de bord : l'upsert compare, et un champ identique ne déclenche rien.
 */
import { useMutation } from '@tanstack/react-query'
import { apiClient, unwrap } from './client'
import { getSession, setSession } from '../auth/session'

export type UpdateProfileInput = {
  username: string
  email: string
  /** Renseignés ensemble, ou pas du tout. */
  password?: { current: string; next: string }
}

export type UpdateProfileResult = {
  /** Vrai quand l'adresse a changé : le jeton courant ne vaut plus rien. */
  requiresReauthentication: boolean
}

export function useUpdateProfile() {
  return useMutation<UpdateProfileResult, Error, UpdateProfileInput>({
    mutationFn: async (input) => {
      const session = getSession()
      if (!session) throw new Error('Connectez-vous pour modifier votre profil.')

      const id = session.user.id
      if (id === null || id === undefined) {
        throw new Error('Compte non identifié : reconnectez-vous.')
      }

      const emailChanged = input.email !== session.user.email

      const result = await apiClient.PATCH('/api/users/{id}', {
        params: { path: { id: String(id) } },
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: {
          username: input.username,
          email: input.email,
          ...(input.password
            ? { plainPassword: input.password.next, currentPassword: input.password.current }
            : {}),
        },
      })

      unwrap(result)

      // Adresse inchangée : le jeton reste valable, la session est simplement
      // remise à jour pour que l'écran reflète le nouveau pseudo sans recharger.
      if (!emailChanged) {
        setSession({
          ...session,
          user: { ...session.user, username: input.username, email: input.email },
        })
      }

      return { requiresReauthentication: emailChanged }
    },
  })
}
