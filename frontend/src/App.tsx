import type { ReactNode } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { CatalogPage } from './pages/CatalogPage'
import { ComingSoon, NotFoundPage } from './pages/ComingSoon'
import { USE_MOCKS } from './config'

const NAV_ITEMS = [
  { to: '/', label: 'Catalogue', end: true },
  { to: '/favorites', label: 'Favoris', end: false },
  { to: '/profile', label: 'Profil', end: false },
]

function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <NavLink to="/" className="brand">
            <span className="brand__mark" aria-hidden="true" />
            manga<span className="brand__accent">stream</span>
          </NavLink>

          <nav className="nav" aria-label="Navigation principale">
            {NAV_ITEMS.map((item) => (
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

          {USE_MOCKS && (
            <span className="badge badge--mock" title="VITE_USE_MOCKS=true — MSW intercepte /api">
              mocks
            </span>
          )}
        </div>
      </header>

      <main className="main">{children}</main>

      <footer className="footer">
        manga-stream · phase 1 · données simulées via MSW tant que l’API n’est pas branchée
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route
          path="/anime/:id"
          element={<ComingSoon title="Fiche anime" note="Synopsis, épisodes, commentaires." />}
        />
        <Route
          path="/manga/:id"
          element={<ComingSoon title="Fiche manga" note="Synopsis, chapitres, commentaires." />}
        />
        <Route
          path="/favorites"
          element={<ComingSoon title="Favoris" note="Votre liste de suivi personnelle." />}
        />
        <Route
          path="/profile"
          element={<ComingSoon title="Profil" note="Compte, progression et préférences." />}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  )
}
