import type { ReactNode } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router-dom'
import { CatalogPage } from './pages/CatalogPage'
import { PlanningPage } from './pages/PlanningPage'
import { MediaDetailPage } from './pages/MediaDetailPage'
import { ListPage } from './pages/ListPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { RecommendationsPage } from './pages/RecommendationsPage'
import { ProfilePage } from './pages/ProfilePage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { PasswordForgotPage } from './pages/PasswordForgotPage'
import { PasswordResetPage } from './pages/PasswordResetPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { Avatar } from './components/Avatar'
import { BrandMark } from './components/BrandMark'
import { NotificationBell } from './components/NotificationBell'
import { RequireAuth } from './auth/RequireAuth'
import { useAuth } from './auth/useAuth'
import { USE_MOCKS } from './config'

/**
 * `authOnly` : l'entrée n'apparaît que connecté. Les recommandations n'ont
 * aucun sens anonyme — l'endpoint répond 401 et l'écran ne pourrait afficher
 * qu'une invitation à se connecter, ce que la barre de compte fait déjà.
 */
const NAV_ITEMS = [
  { to: '/', label: 'Catalogue', end: true, authOnly: false },
  // Juste après le catalogue, et avant tout le reste : c'est l'écran qu'un
  // utilisateur de tracker ouvre quotidiennement.
  { to: '/list', label: 'Ma liste', end: false, authOnly: true },
  // Ouvert aux anonymes : « qu'est-ce qui sort cette saison » est une question
  // qu'on se pose avant d'avoir un compte, pas après.
  { to: '/planning', label: 'Planning', end: false, authOnly: false },
  { to: '/recommendations', label: 'Pour vous', end: false, authOnly: true },
  { to: '/favorites', label: 'Favoris', end: false, authOnly: false },
  { to: '/profile', label: 'Profil', end: false, authOnly: false },
]

function AppShell({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, logout } = useAuth()
  const navItems = NAV_ITEMS.filter((item) => !item.authOnly || isAuthenticated)

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <NavLink to="/" className="brand">
            <BrandMark />
            manga<span className="brand__accent">stream</span>
          </NavLink>

          <nav className="nav" aria-label="Navigation principale">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav__link ${isActive ? 'is-active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="topbar__right">
            {USE_MOCKS && (
              <span className="badge badge--mock" title="VITE_USE_MOCKS=true — MSW intercepte /api">
                mocks
              </span>
            )}

            {/* The bell only makes sense — and only queries — when signed in. */}
            {isAuthenticated && <NotificationBell />}

            {isAuthenticated ? (
              <div className="account">
                <Link to="/profile" className="account__name">
                  <Avatar name={user?.username ?? ''} size="sm" />
                  <span>{user?.username}</span>
                </Link>
                <button type="button" className="btn btn--ghost btn--sm" onClick={logout}>
                  Déconnexion
                </button>
              </div>
            ) : (
              <div className="account">
                <Link to="/login" className="btn btn--ghost btn--sm">
                  Connexion
                </Link>
                <Link to="/register" className="btn btn--primary btn--sm">
                  Inscription
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="main">{children}</main>

      <footer className="footer">
        manga-stream · suivi d’animes et de mangas ·{' '}
        {USE_MOCKS ? 'données simulées via MSW' : 'API réelle'}
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/planning" element={<PlanningPage />} />
        <Route path="/anime/:id" element={<MediaDetailPage kind="anime" />} />
        <Route path="/manga/:id" element={<MediaDetailPage kind="manga" />} />

        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Hors `RequireAuth` par nature : on y arrive justement sans pouvoir
            se connecter. Le jeton du lien reçu par email tient lieu de preuve. */}
        <Route path="/password/forgot" element={<PasswordForgotPage />} />
        <Route path="/password/reset" element={<PasswordResetPage />} />

        <Route
          path="/list"
          element={
            <RequireAuth>
              <ListPage />
            </RequireAuth>
          }
        />
        <Route
          path="/favorites"
          element={
            <RequireAuth>
              <FavoritesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/recommendations"
          element={
            <RequireAuth>
              <RecommendationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  )
}
