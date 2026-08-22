const EARTH_RADIUS_KM = 6371;

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * Calculates the straight-line distance between two coordinates
 * using the Haversine formula.
 * @returns Distance in kilometres
 */
export function haversineDistance(a: Coordinate, b: Coordinate): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);

  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const haversine = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;

  const c = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return EARTH_RADIUS_KM * c;
}

/**
 * Given a list of coordinates, returns the maximum pairwise distance
 * between any two points in the list.
 */
export function maxPairwiseDistance(coords: Coordinate[]): number {
  let max = 0;

  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      const dist = haversineDistance(coords[i], coords[j]);
      if (dist > max) max = dist;
    }
  }

  return max;
}

/**
 * East Legon, Accra — hardcoded origin / place of stay
 */
export const ORIGIN: Coordinate = {
  latitude: 5.636,
  longitude: -0.1569,
};

/**
 * Maximum straight-line distance allowed between any two sites
 * within the same touring day (~3 hour drive threshold).
 */
export const MAX_DAILY_DISTANCE_KM = 250;
