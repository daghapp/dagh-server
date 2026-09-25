import { z } from "zod";
import { PaymentGatewayEnvironment } from "../../generated/prisma/client.js";

/**
 * Request schemas for the admin payment-gateway settings surface.
 *
 * These validate *shape only*. The rules that carry real business weight —
 * "a blank secret means no change, not clear", "you cannot enable processing
 * while disconnected" — live in the service layer, because they depend on
 * currently stored state that a stateless schema cannot see.
 *
 * Credentials are accepted here as plain strings and are write-only: nothing in
 * this module echoes them back, and no response schema includes them.
 */

const CLIENT_ID_MAX = 128;
const CLIENT_SECRET_MAX = 512;

/**
 * Partial credential/environment update.
 *
 * A blank or whitespace-only `clientId` / `clientSecret` is treated as "no
 * change" by the service. Removing a stored secret requires the explicit
 * `clearClientSecret` flag so an empty string from a buggy or truncated client
 * can never silently destroy a working credential.
 */
export const updatePaymentGatewaySettingsSchema = z
  .object({
    clientId: z.string().max(CLIENT_ID_MAX, "Client ID is too long").optional(),
    clientSecret: z.string().max(CLIENT_SECRET_MAX, "Client secret is too long").optional(),
    clearClientSecret: z.boolean().optional(),
    environment: z.enum(PaymentGatewayEnvironment).optional(),
  })
  .refine(
    (value) =>
      Boolean(value.clientId) ||
      Boolean(value.clientSecret) ||
      value.clearClientSecret !== undefined ||
      value.environment !== undefined,
    { message: "Provide at least one of clientId, clientSecret, clearClientSecret or environment" },
  );

export type UpdatePaymentGatewaySettings = z.infer<typeof updatePaymentGatewaySettingsSchema>;

/**
 * Connection test. Every field is optional — an empty body is valid and means
 * "test whatever is currently stored", which is the common case. An admin may
 * alternatively test credentials they have typed but not yet saved (the
 * "in-flight, unsaved" case in the handoff).
 */
export const testPaymentGatewayConnectionSchema = z.object({
  clientId: z.string().max(CLIENT_ID_MAX, "Client ID is too long").optional(),
  clientSecret: z.string().max(CLIENT_SECRET_MAX, "Client secret is too long").optional(),
  environment: z.enum(PaymentGatewayEnvironment).optional(),
});

export type TestPaymentGatewayConnection = z.infer<typeof testPaymentGatewayConnectionSchema>;

/** Master enable/disable switch. */
export const setPaymentProcessingSchema = z.object({
  enabled: z.boolean({ message: "enabled is required and must be a boolean" }),
  reason: z.string().max(500, "Reason must not exceed 500 characters").optional(),
});

export type SetPaymentProcessing = z.infer<typeof setPaymentProcessingSchema>;
