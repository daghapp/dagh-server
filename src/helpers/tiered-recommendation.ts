/**
 * Tiered recommendation resolution (§1 + §2).
 *
 * The accommodation engine and the mobility engine share one lookup strategy:
 *
 *   Tier 1 — PRIMARY: the verified internal database, filtered by radius around
 *            the tour site and the traveller's category preference.
 *   Tier 2 — FALLBACK: when the primary tier returns zero or fewer than
 *            `minResults` matches, a wider/external query runs (geographic
 *            bounds around the site: external places data for lodging, or the
 *            national public-transport catalogue for mobility). Fallback
 *            options are surfaced to the caller so they can be injected into
 *            the itinerary with a distinct tag
 *            ("Suggested Alternative Accommodation" / transport equivalent).
 *
 * Pure and promise-agnostic so both engines — and the tests — can drive it
 * with their own query closures.
 */

export type RecommendationTier = "primary" | "fallback";

export interface TieredQuery<T> {
  /** Tier 1: verified supply within the radius, type-filtered and distance sorted. */
  queryPrimary: () => T[] | Promise<T[]>;
  /** Tier 2: external/wider supply, only consulted when tier 1 is insufficient. */
  queryFallback: () => T[] | Promise<T[]>;
  /** How many primary matches count as "enough". Defaults to 1. */
  minResults?: number;
  /** Hard cap on the merged result. Defaults to Infinity. */
  limit?: number;
}

export interface TieredResult<T> {
  options: T[];
  tier: RecommendationTier;
  /** True when neither tier produced a single usable option. */
  exhausted: boolean;
}

/** Drops duplicate ids while preserving first-seen (primary-first) order. */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * Runs tier 1, and only escalates to tier 2 when tier 1 falls short. The
 * merged list always keeps primary (verified) options ahead of fallback ones
 * so the traveller sees internally-vetted supply first.
 */
export async function resolveTieredOptions<T extends { id: string }>(
  query: TieredQuery<T>,
): Promise<TieredResult<T>> {
  const minResults = query.minResults ?? 1;
  const limit = query.limit ?? Number.POSITIVE_INFINITY;

  const primary = await query.queryPrimary();
  if (primary.length >= minResults) {
    return {
      options: primary.slice(0, limit),
      tier: "primary",
      exhausted: primary.length === 0,
    };
  }

  const fallback = await query.queryFallback();
  const merged = dedupeById([...primary, ...fallback]).slice(0, limit);

  return {
    options: merged,
    tier: fallback.length > 0 ? "fallback" : "primary",
    exhausted: merged.length === 0,
  };
}
