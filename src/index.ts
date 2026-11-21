import "./instrument.js";
import { server } from "./server.js";
import { syncTourSites } from "../scripts/sync-tour-sites.js";

const PORT = process.env.PORT || 5000;

void syncTourSites().catch((error) => {
  console.error("[startup] tour-site sync failed; continuing", error);
});

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
