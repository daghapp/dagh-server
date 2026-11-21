import { pathToFileURL } from "node:url";
import { prisma } from "../src/config/index.js";
import { allowedCountries } from "../src/seed-data/allowed-countries.js";

export async function syncAllowedCountries() {
  for (const country of allowedCountries) {
    await prisma.allowedCountry.upsert({
      where: { code: country.code },
      create: country,
      update: { name: country.name },
    });
  }
  console.log(`Allowed countries: ${allowedCountries.length} synced.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncAllowedCountries()
    .catch((error) => {
      console.error("Allowed-country sync failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
