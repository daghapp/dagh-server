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
