/**
 * Helpers for the JSON-LD / Hydra envelope served by API Platform.
 *
 * The contract's `HydraCollectionBaseSchema` exposes `member` / `totalItems` /
 * `view` (API Platform 4 vocabulary). We additionally tolerate the legacy
 * prefixed keys (`hydra:member`, `hydra:totalItems`, `hydra:view`) so a
 * serializer or vocabulary-config difference on the backend cannot blank out
 * the UI.
 */

export type HydraCollection<T> = {
  member: T[]
  totalItems: number
  /** True when the Hydra view advertises a `next` page. */
  hasNextPage: boolean
}

type HydraView = {
  next?: string | null
  'hydra:next'?: string | null
}

type RawHydraCollection<T> = {
  member?: T[]
  'hydra:member'?: T[]
  totalItems?: number
  'hydra:totalItems'?: number
  view?: HydraView
  'hydra:view'?: HydraView
}

/** Normalises either Hydra dialect into a single predictable shape. */
export function normalizeCollection<T>(raw: RawHydraCollection<T> | undefined): HydraCollection<T> {
  const member = raw?.member ?? raw?.['hydra:member'] ?? []
  const totalItems = raw?.totalItems ?? raw?.['hydra:totalItems'] ?? member.length
  const view = raw?.view ?? raw?.['hydra:view']
  const next = view?.next ?? view?.['hydra:next']

  return { member, totalItems, hasNextPage: Boolean(next) }
}
