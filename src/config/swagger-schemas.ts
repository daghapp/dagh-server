/**
 * Reusable OpenAPI component schemas.
 *
 * Kept in their own module (rather than inline in a route file) so that the
 * `components.schemas` block in src/config/swagger.ts and the `@swagger` JSDoc
 * in the routes can share one definition without either importing the other.
 */

/**
 * The payment gateway configuration projection returned by the API.
 *
 * The absence of `clientId` and `clientSecret` is the point: the API reports
 * only whether a credential is stored, never its value.
 */
export const SANITIZED_CONFIG_SCHEMA = {
  type: "object",
  properties: {
    provider: { type: "string", enum: ["HUBTEL"] },
    environment: { type: "string", enum: ["TEST", "LIVE"] },
    connectionStatus: {
      type: "string",
      enum: ["NOT_CONNECTED", "CONNECTED", "ERROR"],
    },
    connectedEnvironment: { type: "string", enum: ["TEST", "LIVE"], nullable: true },
    connected: {
      type: "boolean",
      description:
        "True only when the connection is verified AND was verified for the currently selected environment",
    },
    paymentProcessingEnabled: { type: "boolean" },
    hasClientId: { type: "boolean" },
    hasClientSecret: { type: "boolean" },
    configured: { type: "boolean" },
    credentialSource: {
      type: "string",
      enum: ["database", "environment"],
      description: "Whether credentials come from the database or the HUBTEL_* env vars",
    },
    lastTestedAt: { type: "string", format: "date-time", nullable: true },
    lastConnectedAt: { type: "string", format: "date-time", nullable: true },
    lastErrorCategory: { type: "string", nullable: true },
    processingDisabledReason: { type: "string", nullable: true },
    updatedBy: { type: "string", nullable: true },
    createdAt: { type: "string", format: "date-time", nullable: true },
    updatedAt: { type: "string", format: "date-time", nullable: true },
  },
};

/**
 * The one YouTube subscription decision.
 *
 * Every community surface returns this same object, and a client must never
 * derive access from anything else — not from a card's `isUnlocked`, not from a
 * cache, and never from a callback's query string. Two endpoints answering
 * differently about the same user is the failure this shape exists to prevent.
 *
 * `accessVersion` is the ordering key. Responses can arrive out of order (a
 * background poll racing a foreground refresh), so a client applies only the
 * highest version it has seen. `accessExpiresAt` is when the lease lapses, after
 * which the next request re-checks Google rather than trusting the verdict.
 *
 * The status enum and the `hasChannelAccess` boolean are not redundant: the
 * boolean is derived (true only for SUBSCRIBED with an unexpired lease), so it is
 * what a client should branch on, while the status says why. `CHECK_FAILED`
 * exists precisely so "we could not ask" is never rendered as "you cancelled".
 */
export const CHANNEL_ACCESS_SCHEMA = {
  type: "object",
  properties: {
    channelId: {
      type: "string",
      description: "The YouTube channel the subscription is checked against.",
    },
    status: {
      type: "string",
      enum: ["SUBSCRIBED", "NOT_SUBSCRIBED", "NOT_CONNECTED", "REAUTH_REQUIRED", "CHECK_FAILED"],
      description:
        "SUBSCRIBED with an expired lease still reports SUBSCRIBED — the verdict is " +
        "stale, not reversed. Use hasChannelAccess to decide, reason to explain.",
    },
    hasChannelAccess: {
      type: "boolean",
      description: "True only for status SUBSCRIBED with an unexpired lease.",
    },
    verifiedAt: {
      type: "string",
      format: "date-time",
      nullable: true,
      description: "When Google last answered.",
    },
    accessExpiresAt: {
      type: "string",
      format: "date-time",
      nullable: true,
      description:
        "When the lease lapses. After this the next read re-checks Google instead of " +
        "trusting the verdict. Null when there is no positive verdict to expire.",
    },
    accessVersion: {
      type: "integer",
      description:
        "Monotonic per (user, channel). Clients must ignore any response whose " +
        "accessVersion is lower than one they have already applied.",
    },
    requiresGoogleConnection: {
      type: "boolean",
      description: "True when the user must connect or reconnect Google before anything unlocks.",
    },
    reason: {
      type: "string",
      nullable: true,
      enum: [
        "GOOGLE_NOT_CONNECTED",
        "REAUTHORIZATION_REQUIRED",
        "VERIFICATION_UNAVAILABLE",
        "NOT_SUBSCRIBED",
        "LEASE_EXPIRED",
        "VERIFICATION_NOT_CONFIGURED",
        null,
      ],
      description: "Why access is not open, for the app's copy. Null whenever it is open.",
    },
  },
};
