import { useSearchParams } from 'react-router-dom'
import { usePlanning } from '../api/planning'
import { MediaCard, MediaCardSkeleton } from '../components/MediaCard'
import {
  currentSeason,
  parseSeasonSlot,
  seasonTitle,
  shiftSeason,
  type SeasonSlot,
} from '../lib/season'
import { STATUS_LABELS, type MediaItem, type MediaStatus } from '../types/media'

/**
 * `/planning` — ce qui sort, saison par saison.
 *
 * ── La saison vit dans l'URL ──────────────────────────────────────────────
 * `?season=SUMMER&year=2026` plutôt qu'un `useState` : un planning se partage
 * (« regarde la saison prochaine »), se met en favori, et survit à un
 * rechargement. La saison en cours n'est que le défaut, pas un état.
 *
 * ── Regroupé par statut, pas par date ─────────────────────────────────────
 * « Ce qui est diffusé maintenant » et « ce qui n'a pas encore commencé » ne
 * se lisent pas de la même façon, alors qu'une liste triée par popularité les
 * mélange. Le tri fin par date du prochain épisode demanderait
 * `nextAiringEpisode`, qu'AniList expose mais que l'import ne récupère pas
 * encore — voir `api/planning.ts`.
 */

/** Ordre d'affichage : ce qui se regarde aujourd'hui d'abord. */
const GROUPS: { status: MediaStatus; heading: string }[] = [
  { status: 'RELEASING', heading: 'En diffusion' },
  { status: 'NOT_YET_RELEASED', heading: 'À venir' },
  { status: 'FINISHED', heading: 'Terminés' },
  { status: 'HIATUS', heading: STATUS_LABELS.HIATUS },
  { status: 'CANCELLED', heading: STATUS_LABELS.CANCELLED },
]

function SeasonNav({ slot, onChange }: { slot: SeasonSlot; onChange: (next: SeasonSlot) => void }) {
  const now = currentSeason(new Date())
  const isCurrent = slot.season === now.season && slot.year === now.year

  return (
    <div className="season-nav">
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => onChange(shiftSeason(slot, -1))}
      >
        ← {seasonTitle(shiftSeason(slot, -1))}
      </button>

      {!isCurrent && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(now)}>
          Saison en cours
        </button>
      )}

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => onChange(shiftSeason(slot, 1))}
      >
        {seasonTitle(shiftSeason(slot, 1))} →
      </button>
    </div>
  )
}

function Group({ heading, items }: { heading: string; items: MediaItem[] }) {
  if (items.length === 0) return null

  return (
    <section>
      <h2 className="section__title">
        {heading} <span className="section__count">{items.length}</span>
      </h2>
      <div className="grid">
        {items.map((item) => (
          <MediaCard key={item.key} item={item} />
        ))}
      </div>
    </section>
  )
}

export function PlanningPage() {
  const [params, setParams] = useSearchParams()

  const slot = parseSeasonSlot(
    params.get('season'),
    params.get('year'),
    currentSeason(new Date()),
  )

  const { items, totalItems, isLoading, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    usePlanning(slot)

  const goTo = (next: SeasonSlot) => {
    setParams({ season: next.season, year: String(next.year) })
  }

  // Un statut inconnu du regroupement ne doit pas faire disparaître l'œuvre :
  // ce qui n'entre dans aucun groupe est rassemblé à la fin.
  const grouped = GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.status === group.status),
  }))
  const known = new Set(GROUPS.map((group) => group.status))
  const others = items.filter((item) => item.status === null || !known.has(item.status))

  return (
    <div className="catalog">
      <header className="catalog__header">
        <div>
          <h1 className="catalog__title">Planning — {seasonTitle(slot)}</h1>
          <p className="catalog__count">
            {isLoading
              ? 'Chargement…'
              : totalItems === 0
                ? 'Aucun anime pour cette saison'
                : `${totalItems} anime${totalItems > 1 ? 's' : ''}`}
          </p>
        </div>
        <SeasonNav slot={slot} onChange={goTo} />
      </header>

      {isError && (
        <div className="panel panel--error" role="alert">
          {error instanceof Error ? error.message : 'Planning indisponible'}
        </div>
      )}

      {isLoading && (
        <div className="grid">
          {Array.from({ length: 12 }, (_, index) => (
            <MediaCardSkeleton key={index} />
          ))}
        </div>
      )}

      {!isLoading && !isError && totalItems === 0 && (
        <p className="muted">
          Rien d’importé pour {seasonTitle(slot)}. Le catalogue suit la popularité AniList :
          les saisons anciennes ou très récentes peuvent être vides.
        </p>
      )}

      {grouped.map((group) => (
        <Group key={group.status} heading={group.heading} items={group.items} />
      ))}
      <Group heading="Statut inconnu" items={others} />

      {hasNextPage && (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Chargement…' : 'Voir la suite de la saison'}
        </button>
      )}
    </div>
  )
}
