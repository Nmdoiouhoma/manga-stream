/**
 * Édition du compte depuis le profil.
 *
 * Le cas qui mérite vraiment un test est le changement d'adresse : l'e-mail est
 * l'identifiant de connexion, le jeton en cours devient donc caduc
 * (`ProfileUpdateTest::testChangingTheEmailInvalidatesTheCurrentToken()` le
 * prouve côté backend). Sans traitement explicite, l'utilisateur se ferait
 * éjecter sans explication juste après une modification réussie.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProfilePage } from './ProfilePage'
import { LoginPage } from './LoginPage'
import { AuthProvider } from '../auth/AuthContext'
import { getSession, setSession } from '../auth/session'
import { fetchCalls, setFetchHandler } from '../test/http'

const USER = {
  iri: '/api/users/1',
  id: 1,
  username: 'testeur',
  email: 'avant@example.test',
  roles: ['ROLE_USER'],
}

function emptyCollection(): Response {
  return new Response(
    JSON.stringify({ '@context': '/api/contexts/X', '@type': 'Collection', totalItems: 0, member: [] }),
    { status: 200, headers: { 'Content-Type': 'application/ld+json' } },
  )
}

/** Collections du profil vides, PATCH accepté — sauf indication contraire. */
function handleWith(patch: () => Response) {
  setFetchHandler((request) =>
    request.method === 'PATCH' ? patch() : emptyCollection(),
  )
}

function okPatch(): Response {
  return new Response(JSON.stringify({ '@id': '/api/users/1', '@type': 'User', id: 1 }), {
    status: 200,
    headers: { 'Content-Type': 'application/ld+json' },
  })
}

function renderProfile() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/profile']}>
        <AuthProvider>
          <Routes>
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function openEditor() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Modifier' }))
  return user
}

beforeEach(() => {
  setSession({ token: 'jeton-de-test', user: { ...USER } })
})

afterEach(() => {
  setSession(null)
})

describe('ProfilePage — édition du compte', () => {
  it('reste replié tant qu’on ne demande pas à modifier', () => {
    handleWith(okPatch)
    renderProfile()

    expect(screen.getByRole('button', { name: 'Modifier' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Pseudo')).not.toBeInTheDocument()
  })

  it('envoie le pseudo et l’adresse ensemble, et met la session à jour', async () => {
    handleWith(okPatch)
    renderProfile()
    const user = await openEditor()

    await user.clear(screen.getByLabelText('Pseudo'))
    await user.type(screen.getByLabelText('Pseudo'), 'nouveaupseudo')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(screen.getByText('Profil mis à jour.')).toBeInTheDocument())

    const patch = fetchCalls().find((call) => call.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(new URL(patch!.url).pathname).toBe('/api/users/1')
    expect(patch!.headers.get('Content-Type')).toContain('merge-patch+json')

    // La session porte le nouveau pseudo : l'écran ne doit pas exiger un F5.
    expect(getSession()?.user.username).toBe('nouveaupseudo')
    expect(getSession()?.user.email).toBe('avant@example.test')
  })

  it('prévient avant d’enregistrer qu’un changement d’adresse déconnecte', async () => {
    handleWith(okPatch)
    renderProfile()
    const user = await openEditor()

    expect(screen.queryByText(/met fin à cette session/)).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Adresse e-mail'))
    await user.type(screen.getByLabelText('Adresse e-mail'), 'apres@example.test')

    expect(screen.getByText(/met fin à cette session/)).toBeInTheDocument()
  })

  it('déconnecte et explique pourquoi après un changement d’adresse', async () => {
    handleWith(okPatch)
    renderProfile()
    const user = await openEditor()

    await user.clear(screen.getByLabelText('Adresse e-mail'))
    await user.type(screen.getByLabelText('Adresse e-mail'), 'apres@example.test')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByText(/Elle sert d’identifiant/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument()
    expect(getSession()).toBeNull()
  })

  it('réclame le mot de passe actuel dès qu’un nouveau est saisi', async () => {
    handleWith(okPatch)
    renderProfile()
    const user = await openEditor()

    expect(screen.queryByLabelText('Mot de passe actuel')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Nouveau mot de passe'), 'motdepasselong1')

    expect(screen.getByLabelText('Mot de passe actuel')).toBeInTheDocument()
  })

  it('affiche le refus du serveur au lieu de prétendre avoir enregistré', async () => {
    handleWith(
      () =>
        new Response(
          JSON.stringify({
            '@type': 'ConstraintViolationList',
            violations: [
              { propertyPath: 'username', message: 'Ce nom d’utilisateur est déjà pris.' },
            ],
          }),
          { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
        ),
    )
    renderProfile()
    const user = await openEditor()

    await user.clear(screen.getByLabelText('Pseudo'))
    await user.type(screen.getByLabelText('Pseudo'), 'occupe')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('déjà pris')
    expect(screen.queryByText('Profil mis à jour.')).not.toBeInTheDocument()
    expect(getSession()?.user.username).toBe('testeur')
  })
})
