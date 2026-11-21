import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { prisma } from "../src/config/index.js";
import { tourPackages } from "../src/seed-data/tour-packages.js";

export async function syncTourPackages() {
  let created = 0;
  let enriched = 0;

  for (const tour of tourPackages) {
    const existing = await prisma.tour_packages.findUnique({ where: { slug: tour.slug } });

    if (!existing) {
      await prisma.tour_packages.create({
        data: {
          title: tour.title,
          slug: tour.slug,
          category: tour.category,
          subcategory: tour.subcategory,
          categories: tour.categories,
          region: tour.region,
          location: tour.region,
          durationDays: tour.durationDays,
          durationNights: tour.durationNights,
          basePrice: tour.basePrice,
          currency: "GHS",
          status: "published",
          featured: tour.featured,
          trending: tour.trending,
          shortDescription: tour.shortDescription,
          description: tour.description,
          coverImage: tour.coverImage,
          overallRating: 4.7,
          ratingCount: 24,
          viewCount: 312,
          bookingCount: 8,
          tour_locations: {
            create: tour.locations.map((name) => ({
              id: randomUUID(),
              name,
              city: tour.region,
              region: tour.region,
              description: name,
              visitDuration: 90,
              photos: [tour.coverImage],
            })),
          },
          tour_media: {
            create: [{ id: randomUUID(), media_type: "image", url: tour.coverImage }],
          },
          pricing_includes: {
            create: tour.includes.map((item) => ({ id: randomUUID(), item })),
          },
          pricing_excludes: {
            create: tour.excludes.map((item) => ({ id: randomUUID(), item })),
          },
          tour_itineraries: {
            create: Array.from({ length: tour.durationDays }, (_, index) => ({
              dayNumber: index + 1,
              title: `Day ${index + 1}`,
              description: tour.shortDescription,
              breakfast: true,
              lunch: true,
              dinner: false,
              itinerary_activities: {
                create: [
                  {
                    id: randomUUID(),
                    activityTime: "09:00",
                    activity: `Explore ${tour.locations[0]}`,
                    durationMinutes: 180,
                    included: true,
                    locationName: tour.locations[0],
                  },
                ],
              },
            })),
          },
        },
      });
      created += 1;
      continue;
    }

    const patch: { coverImage?: string; category?: string; region?: string } = {};
    if (!existing.coverImage) patch.coverImage = tour.coverImage;
    if (!existing.category) patch.category = tour.category;
    if (!existing.region) patch.region = tour.region;
    if (Object.keys(patch).length > 0) {
      await prisma.tour_packages.update({ where: { id: existing.id }, data: patch });
      enriched += 1;
    }
  }

  const published = await prisma.tour_packages.count({ where: { status: "published" } });
  console.log(`Created ${created} tour packages.`);
  console.log(`Enriched ${enriched} existing tour packages.`);
  console.log(`Published tour packages: ${published}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncTourPackages()
    .catch((error) => {
      console.error("Tour-package sync failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
