import * as Sentry from "@sentry/node";

// Initialize Sentry before anything else so crashes are captured from the very
// start of the process. Set SENTRY_DSN to enable reporting (see .env.example);
// without it the SDK is disabled so local dev stays quiet.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  const configuredRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE);
  const tracesSampleRate = Number.isFinite(configuredRate)
    ? configuredRate
    : process.env.NODE_ENV === "production"
      ? 0.1
      : 1.0;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE ?? process.env.GIT_COMMIT ?? undefined,
    tracesSampleRate,
  });
} else {
  console.warn("[sentry] SENTRY_DSN is not set - Sentry is disabled");
}
