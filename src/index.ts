import "./instrument.js";
import { server } from "./server.js";
import { syncTourSites } from "../scripts/sync-tour-sites.js";
import { syncAllowedCountries } from "../scripts/sync-allowed-countries.js";
import { syncCommunityVideos } from "../scripts/sync-community-videos.js";
import { syncMembershipPlans } from "../scripts/sync-membership-plans.js";
import { syncTourPackages } from "../scripts/sync-tour-packages.js";

const PORT = process.env.PORT || 5000;

// Run startup syncs sequentially (not concurrently) so a cold database is
// not hit by five parallel sync jobs at once, which previously caused
// connection timeouts on Render/Neon. Each job gets a few retries.
void (async () => {
  const jobs: Array<[string, () => Promise<unknown>]> = [
    ["tour-site", () => syncTourSites()],
    ["allowed-country", () => syncAllowedCountries()],
    ["community-video", () => syncCommunityVideos()],
    ["membership-plan", () => syncMembershipPlans()],
    ["tour-package", () => syncTourPackages()],
  ];

  for (const [name, job] of jobs) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await job();
        break;
      } catch (error) {
        console.error(`[startup] ${name} sync failed (attempt ${attempt}/3); continuing`, error);
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        }
      }
    }
  }
})();

const httpServer = server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

const shutdown = (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  httpServer.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
