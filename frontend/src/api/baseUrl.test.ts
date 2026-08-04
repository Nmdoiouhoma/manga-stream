/**
 * `normalizeBaseUrl` existe pour une seule raison : le contrat déclare
 * `servers: [{ url: "/" }]` et **toutes** ses routes commencent déjà par
 * `/api`, alors que le `docker-compose.yml` partagé configure
 * `VITE_API_URL=http://localhost:8000/api`. Concaténer naïvement demandait
 * `/api/api/animes` — un 404 sur toute l'application, dans la configuration
 * par défaut du dépôt.
 *
 * C'est donc le double `/api` qui est testé ici, pas la fonction en général.
 */
import { describe, expect, it } from 'vitest'
import { normalizeBaseUrl } from './baseUrl'

describe('normalizeBaseUrl', () => {
  it('retire le /api final, celui que le contrat fournit déjà', () => {
    expect(normalizeBaseUrl('http://localhost:8000/api')).toBe('http://localhost:8000')
  })

  it('retire aussi bien le /api que la barre oblique qui le suit', () => {
    expect(normalizeBaseUrl('http://localhost:8000/api/')).toBe('http://localhost:8000')
    expect(normalizeBaseUrl('https://16.171.196.127.nip.io/api//')).toBe(
      'https://16.171.196.127.nip.io',
    )
  })

  it('accepte la convention inverse — une base sans /api — sans la modifier', () => {
    expect(normalizeBaseUrl('http://localhost:8000')).toBe('http://localhost:8000')
    expect(normalizeBaseUrl('http://localhost:8000/')).toBe('http://localhost:8000')
  })

  it('laisse la chaîne vide, qui signifie « même origine »', () => {
    expect(normalizeBaseUrl('')).toBe('')
    expect(normalizeBaseUrl('   ')).toBe('')
    expect(normalizeBaseUrl(undefined)).toBe('')
    expect(normalizeBaseUrl(null)).toBe('')
  })

  it('réduit une base qui ne vaut que « /api » à la même origine', () => {
    expect(normalizeBaseUrl('/api')).toBe('')
    expect(normalizeBaseUrl('/api/')).toBe('')
  })

  it('ne retire qu’un seul segment : /api/api est une adresse, pas une faute à corriger deux fois', () => {
    // Volontaire : la fonction compense la convention du dépôt, elle ne
    // devine pas. Une base doublée reste fautive et doit se voir.
    expect(normalizeBaseUrl('http://localhost:8000/api/api')).toBe('http://localhost:8000/api')
  })

  it('ne touche pas à un /api en milieu de chemin', () => {
    expect(normalizeBaseUrl('https://example.test/api/v2')).toBe('https://example.test/api/v2')
  })

  it('tolère les espaces autour de la valeur, fréquents dans un fichier .env', () => {
    expect(normalizeBaseUrl('  http://localhost:8000/api  ')).toBe('http://localhost:8000')
  })
})
