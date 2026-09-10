/**
 * Payment availability flag.
 *
 * Defaults to disabled — set PAYMENTS_ENABLED=true to re-enable payment
 * processing (Hubtel checkout / MOMO initialization). Callbacks and status
 * verification for already-initiated payments keep working while disabled.
 */
export const paymentsEnabled = process.env.PAYMENTS_ENABLED === "true";

export const PAYMENTS_DISABLED_MESSAGE =
  "Payments are temporarily disabled. Please try again later.";