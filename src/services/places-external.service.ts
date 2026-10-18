import { haversineDistance } from "../helpers/haversine.js";

/**
 * External lodging discovery (§1: Algorithmic Fallback / Proximity Query).
 *
 * When the verified internal supply around a tour site is empty or below the
 * minimum threshold for the traveller's chosen property type, the
 * accommodation engine escalates here: a geographic-bounds query against an
 * external places provider (Google Places Nearby Search) centred on the tour
 * site's coordinates. Results are categorised into the platform's property
 * types from name/type keywords so they slot into the same preference filter
 * as verified supply, and are injected into the itinerary with the
 * "Suggested Alternative Accommodation" tag.
 *
 * Failure / absence of configuration is never fatal: no API key or any
 * transport/parse error resolves to an empty list and the itinerary simply
 * ships without external alternatives.
 */

export type ExternalPropertyType = "HOTEL" | "GUESTHOUSE" | "AIRBNB" | "APARTMENTS" | "MOTEL";

export interface ExternalLodgingResult {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  propertyType: ExternalPropertyType | null;
}

const PLACES_NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const EXTERNAL_FETCH_TIMEOUT_MS = 5_000;
const EXTERNAL_CACHE_TTL_MS = 10 * 60_000;

/** Ordered keyword rules — first match wins, more specific before broader. */
const PROPERTY_TYPE_RULES: Array<{ type: ExternalPropertyType; keywords: string[] }> = [
  { type: "MOTEL", keywords: ["motel", "motor inn", "motor lodge"] },
  {
    type: "GUESTHOUSE",
    keywords: [
      "guest house",
      "guesthouse",
      "lodge",
      "rest house",
      "bed and breakfast",
      "bed & breakfast",
      "b&b",
      "homestay",
      "inn",
    ],
  },
  // More specific than the AIRBNB "apartment" keyword — must come first.
  { type: "APARTMENTS", keywords: ["serviced apartment", "self contained", "residency"] },
  {
    // Spec: apartment rentals are surfaced as "Airbnb" style inventory.
    type: "AIRBNB",
    keywords: ["airbnb", "apartment", "shortlet", "short stay", "self-catering", "studio", "villa"],
  },
  { type: "HOTEL", keywords: ["hotel", "resort", "boutique", "suites"] },
];

/**
 * Classify an external lodging record into the platform property types.
 * Pure — exported for tests. Returns null when no keyword is recognised so
 * the caller can surface the option without a (wrong) type claim.
 */
export function classifyPropertyType(
  ...textInputs: Array<string | undefined | null>
): ExternalPropertyType | null {
  const haystack = textInputs
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .join(" ")
    .toLowerCase();

  for (const rule of PROPERTY_TYPE_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) return rule.type;
  }
  return null;
}

export function isExternalPlacesConfigured(): boolean {
  return !!process.env.GOOGLE_PLACES_API_KEY;
}

// In-memory TTL cache keyed by rounded coordinates — itinerary reads hit the
// same few tour sites repeatedly (per view refresh), external quota is finite.
const nearbyCache = new Map<string, { expiresAt: number; results: ExternalLodgingResult[] }>();

function cacheKey(latitude: number, longitude: number, radiusMeters: number): string {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)},${radiusMeters}`;
}

/** Clears the TTL cache — exposed for tests. */
export function clearExternalPlacesCache(): void {
  nearbyCache.clear();
}

interface PlacesNearbyResponse {
  results?: Array<{
    place_id?: string;
    name?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
    types?: string[];
    vicinity?: string;
  }>;
  status?: string;
}

/**
 * Geographic-bounds lodging query around a point. Returns [] when the
 * integration is not configured or the call fails — the tiered engine treats
 * that as "no fallback available" and keeps whatever the primary tier found.
 */
export async function fetchNearbyLodging(
  latitude: number,
  longitude: number,
  radiusMeters = 5_000,
): Promise<ExternalLodgingResult[]> {
  if (!isExternalPlacesConfigured()) return [];

  const key = cacheKey(latitude, longitude, radiusMeters);
  const cached = nearbyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.results;

  try {
    const params = new URLSearchParams({
      location: `${latitude},${longitude}`,
      radius: String(radiusMeters),
      type: "lodging",
      key: process.env.GOOGLE_PLACES_API_KEY!,
    });
    const response = await fetch(`${PLACES_NEARBY_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as PlacesNearbyResponse;
    const results: ExternalLodgingResult[] = (payload.results ?? [])
      .filter(
        (r) =>
          r.place_id &&
          r.name &&
          r.geometry?.location?.lat != null &&
          r.geometry?.location?.lng != null,
      )
      .map((r) => ({
        id: `ext:${r.place_id}`,
        name: r.name!,
        latitude: r.geometry!.location!.lat!,
        longitude: r.geometry!.location!.lng!,
        propertyType: classifyPropertyType(r.name, r.types?.join(" "), r.vicinity),
      }));

    nearbyCache.set(key, { expiresAt: Date.now() + EXTERNAL_CACHE_TTL_MS, results });
    return results;
  } catch (error) {
    // External discovery must never break itinerary generation.
    console.warn("[places] external lodging lookup failed:", (error as Error).message);
    return [];
  }
}

/** External results within `radiusKm` of an anchor, distance sorted. */
export async function fetchLodgingWithinRadius(
  anchor: { latitude: number; longitude: number },
  radiusKm: number,
): Promise<Array<ExternalLodgingResult & { distanceKm: number }>> {
  const results = await fetchNearbyLodging(anchor.latitude, anchor.longitude, radiusKm * 1000);
  return results
    .map((r) => ({ ...r, distanceKm: haversineDistance(anchor, r) }))
    .filter((r) => r.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
