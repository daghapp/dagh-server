import * as Sentry from "@sentry/node";

// Initialize Sentry before anything else so crashes are captured from the very
// start of the process. The DSN can be overridden via the SENTRY_DSN env var.
Sentry.init({
  dsn:
    process.env.SENTRY_DSN ??
    "https://a41d851d4698aabe17037ec7f8be6402@o4511871123062784.ingest.de.sentry.io/4511875917414480",
  environment: process.env.NODE_ENV ?? "development",
});
