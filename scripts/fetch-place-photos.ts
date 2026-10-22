/**
 * Enrich tour-site photos from Google Places API (New).
 *
 * For each tour site this runs a Text Search anchored on the site's
 * coordinates, takes the first matching place with a photo, follows the
 * photo-media redirect and stores the resolved image URL plus the author
 * attribution (`imageCredit`) on `tour_sites` and the seeded gallery row.
 *
 * Requires a server-side API key with Places API (New) enabled and NO Android
 * application restriction — the app-restricted key used by the mobile client
 * returns API_KEY_ANDROID_APP_BLOCKED here.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY="..." npx tsx scripts/fetch-place-photos.ts --dry-run
 *   GOOGLE_PLACES_API_KEY="..." npx tsx scripts/fetch-place-photos.ts --apply
 *   GOOGLE_PLACES_API_KEY="..." npx tsx scripts/fetch-place-photos.ts --apply --only-wikimedia
 *
 * Always writes a report to /tmp/place-photos.json for auditing.
 */
import { prisma } from "../src/config/index.js";

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = "places.id,places.displayName,places.location,places.photos";
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_DELAY_MS = 250;
const REPORT_PATH = "/tmp/place-photos.json";

interface PlacePhoto {
  name: string;
  authorAttributions?: Array<{ displayName?: string }>;
}

interface Place {
  id: string;
  displayName?: { text?: string };
  photos?: PlacePhoto[];
}

interface SearchResponse {
  places?: Place[];
}

interface EnrichmentResult {
  name: string;
  region: string;
  placeId: string;
  placeName: string;
  url: string;
  credit: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchPlace(
  query: string,
  latitude: number,
  longitude: number,
  key: string,
): Promise<Place | null> {
  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 1,
      locationBias: {
        circle: { center: { latitude, longitude }, radius: 5000 },
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Places search ${response.status}: ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as SearchResponse;
  return payload.places?.[0] ?? null;
}

/** Follows the photo-media redirect and returns the final image URL. */
async function resolvePhotoUrl(photoName: string, key: string): Promise<string | null> {
  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1600&key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const location = response.headers.get("location");
  if (location) return location;
  if (response.ok) return response.url;
  return null;
}

async function main() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    console.error("GOOGLE_PLACES_API_KEY is not set.");
    process.exitCode = 1;
    return;
  }

  const apply = process.argv.includes("--apply");
  const onlyWikimedia = process.argv.includes("--only-wikimedia");

  const sites = await prisma.tourSite.findMany({
    select: { id: true, name: true, region: true, latitude: true, longitude: true, imageUrl: true },
    orderBy: [{ region: "asc" }, { name: "asc" }],
  });

  const targets = onlyWikimedia
    ? sites.filter((site) => !site.imageUrl || /wikimedia/i.test(site.imageUrl))
    : sites;

  console.log(
    `${apply ? "[apply] " : "[dry-run] "}Fetching Places photos for ${targets.length}/${sites.length} sites...`,
  );

  const results: EnrichmentResult[] = [];
  const failures: Array<{ name: string; error: string }> = [];

  for (const site of targets) {
    const query = `${site.name}, ${site.region}, Ghana`;
    try {
      const place = await searchPlace(query, site.latitude, site.longitude, key);
      if (!place) {
        failures.push({ name: site.name, error: "no place match" });
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      const photo = place.photos?.[0];
      if (!photo) {
        failures.push({
          name: site.name,
          error: `no photo (${place.displayName?.text ?? place.id})`,
        });
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      const url = await resolvePhotoUrl(photo.name, key);
      if (!url) {
        failures.push({ name: site.name, error: "photo media had no redirect" });
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      const credit = photo.authorAttributions?.[0]?.displayName?.trim() || "Google";
      const result: EnrichmentResult = {
        name: site.name,
        region: site.region,
        placeId: place.id,
        placeName: place.displayName?.text ?? "unknown",
        url,
        credit,
      };
      results.push(result);

      if (apply) {
        await prisma.tourSite.update({
          where: { id: site.id },
          data: { imageUrl: url, imageCredit: credit },
        });
        await prisma.sitePhoto.updateMany({
          where: { tourSiteId: site.id, publicId: `seed-gallery:${site.name}` },
          data: { url, thumbUrl: url },
        });
      }
    } catch (error) {
      failures.push({ name: site.name, error: (error as Error).message });
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const { writeFile } = await import("node:fs/promises");
  await writeFile(REPORT_PATH, JSON.stringify({ results, failures }, null, 2));

  console.log(`${apply ? "Updated" : "Matched"} ${results.length} sites.`);
  console.log(`No usable photo: ${failures.length}. Report: ${REPORT_PATH}`);
  if (failures.length > 0) {
    console.log(
      `First failures: ${failures
        .slice(0, 5)
        .map((f) => `${f.name} (${f.error})`)
        .join("; ")}`,
    );
  }
}

main()
  .catch((error) => {
    console.error("Places photo enrichment failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
