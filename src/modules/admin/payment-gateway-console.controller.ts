import { Request, Response } from "express";
import { _resetHubtelClientCache } from "../../config/hubtel.js";
import { prisma } from "../../config/prisma.js";
import * as gatewayLog from "../../helpers/paymentGatewayLogger.js";
import { fail, ok } from "../../helpers/response.js";
import {
  assertAdminPermission,
  PAYMENT_GATEWAY_PERMISSIONS,
} from "../../middleware/admin-permission.js";
import {
  GatewayConfigError,
  connect,
  getSanitizedConfig,
  setProcessingEnabled,
  testConnection,
  updateSettings,
} from "../../services/payment-gateway-config.service.js";
// Only the test schema is used here: the PUT and PATCH bodies are validated by
// the route-level `validate()` middleware, so re-parsing them here would be
// redundant work.
import {
  testPaymentGatewayConnectionSchema,
  type SetPaymentProcessing,
  type UpdatePaymentGatewaySettings,
} from "../../validator/payment-gateway-validator.js";

/**
 * Admin console — payment gateway settings.
 *
 * Mirrors the endpoint contracts in the UI/UX handoff (§3.1–3.5) on top of the
 * repository's `{ success, data }` / `{ success, error }` response envelope.
 *
 * Two invariants worth calling out because they are enforced here rather than in
 * the schema:
 *
 *  - Nothing in this file ever reads or returns a client secret. Responses carry
 *    `hasClientSecret` only, produced by the service's sanitized projection.
 *  - `connectionStatus` is never accepted from the request body. It is derived by
 *    the service from an actual credential probe.
 */
export class AdminPaymentGatewayController {
  /**
   * GET /admin/settings/payment-gateway
   * Current configuration with secret presence flags.
   */
  async getSettings(req: Request, res: Response) {
    try {
      const config = await getSanitizedConfig();
      const role = await this.resolveRole(req);

      gatewayLog.logSettingsViewed({
        actorId: req.user?.id ?? null,
        requestId: req.requestId ?? null,
        userRole: role,
        connectionStatus: config.connectionStatus,
        environment: config.environment,
      });

      return ok(res, config);
    } catch (error) {
      console.error("[PaymentGateway] getSettings error:", error);
      return fail(res, 500, "Failed to load payment gateway settings");
    }
  }

  /**
   * PUT /admin/settings/payment-gateway
   * Partial update of Client ID, Client Secret and/or environment.
   */
  async updateSettings(req: Request, res: Response) {
    try {
      // Changing the environment is a separate capability from editing
      // credentials, and a single PUT can do both — so the environment half
      // needs its own check that route-level middleware cannot make.
      const wantsEnvironmentChange = req.body?.environment !== undefined;

      if (wantsEnvironmentChange) {
        const denied = await assertAdminPermission(
          req,
          res,
          PAYMENT_GATEWAY_PERMISSIONS.MANAGE_ENVIRONMENT,
        );
        if (denied) return denied;
      }

      const body = (req.body ?? {}) as UpdatePaymentGatewaySettings;

      const outcome = await updateSettings({
        actorId: req.user!.id,
        requestId: req.requestId ?? null,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        clearClientSecret: body.clearClientSecret,
        environment: body.environment,
      });

      // A credential change must not be masked by a 10s credential cache.
      if (outcome.clientIdChanged || outcome.clientSecretChanged || outcome.clientSecretCleared) {
        _resetHubtelClientCache();
      }

      return ok(res, outcome.config, "Payment gateway settings updated");
    } catch (error) {
      if (error instanceof GatewayConfigError) {
        return fail(res, error.status, { code: error.code, message: error.message });
      }
      console.error("[PaymentGateway] updateSettings error:", error);
      return fail(res, 500, "Failed to update payment gateway settings");
    }
  }

  /**
   * POST /admin/settings/payment-gateway/test
   * Non-mutating credential check. Never initiates a transaction, and a passing
   * test does not change `connectionStatus`.
   */
  async testConnection(req: Request, res: Response) {
    try {
      const parsed = testPaymentGatewayConnectionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return fail(res, 400, parsed.error.issues[0]?.message ?? "Invalid request body");
      }

      gatewayLog.logConnectionTestStarted({
        actorId: req.user?.id ?? null,
        requestId: req.requestId ?? null,
        environment: parsed.data.environment ?? "TEST",
      });

      const outcome = await testConnection({
        actorId: req.user!.id,
        requestId: req.requestId ?? null,
        clientId: parsed.data.clientId,
        clientSecret: parsed.data.clientSecret,
        environment: parsed.data.environment,
      });

      const status = outcome.success ? 200 : outcome.retryable ? 503 : 400;

      return res.status(status).json({
        success: outcome.success,
        error: outcome.success ? undefined : outcome.message,
        data: {
          success: outcome.success,
          message: outcome.message,
          checkedAt: outcome.checkedAt.toISOString(),
          retryable: outcome.retryable,
          lastErrorCategory: outcome.config.lastErrorCategory,
        },
      });
    } catch (error) {
      console.error("[PaymentGateway] testConnection error:", error);
      return fail(res, 500, "Failed to test the Hubtel connection");
    }
  }

  /**
   * POST /admin/settings/payment-gateway/connect
   * Verifies credentials and marks the gateway connected for the selected
   * environment. Always returns the server-derived status.
   */
  async connect(req: Request, res: Response) {
    try {
      const outcome = await connect({
        actorId: req.user!.id,
        requestId: req.requestId ?? null,
      });

      if (!outcome.connected) {
        // 502: we reached the provider (or tried to) and it did not work out.
        // The client must not assume success from its own optimistic state.
        return res.status(502).json({
          success: false,
          error: outcome.message,
          data: {
            connectionStatus: outcome.config.connectionStatus,
            environment: outcome.environment,
            lastErrorCategory: outcome.config.lastErrorCategory,
            checkedAt: outcome.checkedAt.toISOString(),
          },
        });
      }

      return ok(res, {
        connectionStatus: outcome.config.connectionStatus,
        connectedAt: outcome.config.lastConnectedAt?.toISOString() ?? null,
        environment: outcome.environment,
      });
    } catch (error) {
      console.error("[PaymentGateway] connect error:", error);
      return fail(res, 500, "Failed to connect to Hubtel");
    }
  }

  /**
   * PATCH /admin/settings/payment-gateway/processing
   * Master enable/disable switch. Rejects enabling while unconnected.
   */
  async setProcessing(req: Request, res: Response) {
    try {
      const body = (req.body ?? {}) as SetPaymentProcessing;

      const outcome = await setProcessingEnabled({
        actorId: req.user!.id,
        requestId: req.requestId ?? null,
        enabled: body.enabled,
        reason: body.reason,
      });

      return ok(res, {
        paymentProcessingEnabled: outcome.paymentProcessingEnabled,
        effectiveAt: outcome.effectiveAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof GatewayConfigError) {
        return fail(res, error.status, { code: error.code, message: error.message });
      }
      console.error("[PaymentGateway] setProcessing error:", error);
      return fail(res, 500, "Failed to update payment processing status");
    }
  }

  private async resolveRole(req: Request): Promise<string> {
    if (!req.user) return "NONE";
    const profile = await prisma.adminProfile.findUnique({
      where: { userId: req.user.id },
      select: { role: true },
    });
    return profile?.role ?? "NONE";
  }
}
