import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";
import {
  AccountType,
  AdminDepartment,
  AdminRole,
  AuthProvider,
} from "../generated/prisma/client.js";
import { prisma } from "../src/config/prisma.js";
import { _resetPaymentControlCache } from "../src/config/payments.js";
import { _resetHubtelClientCache } from "../src/config/hubtel.js";
import { AdminPaymentGatewayController } from "../src/modules/admin/payment-gateway-console.controller.js";
import {
  GatewayConfigError,
  connect,
  getSanitizedConfig,
  isConnectionSatisfied,
  setProcessingEnabled,
  testConnection,
  updateSettings,
} from "../src/services/payment-gateway-config.service.js";

/**
 * Acceptance tests for the payment gateway settings surface, driven against a
 * real database and a real HTTP server standing in for Hubtel.
 *
 * The probe is pointed at a local server rather than mocked so the credential
 * interpretation (401 -> rejected, anything else -> accepted) is genuinely
 * exercised end to end through axios.
 */

const GOOD_CLIENT_ID = "test-client-id";
const GOOD_CLIENT_SECRET = "test-client-secret";

let hubtelStub: Server;
let superAdminId: string;
let financeAdminId: string;
let controller: AdminPaymentGatewayController;

/** Status the stub should return; mutated per-test to drive each branch. */
let stubBehaviour: { status: number; delayMs?: number } = { status: 200 };
/** Credentials the stub saw, so we can assert they were actually transmitted. */
let stubSawAuthorization: string | null = null;

function createMockRes(): {
  res: Response;
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn().mockImplementation(() => ({ json }));
  return { res: { status, json } as unknown as Response, json, status };
}

beforeAll(async () => {
  hubtelStub = createServer((req, res) => {
    stubSawAuthorization = req.headers.authorization ?? null;
    const respond = () => {
      res.writeHead(stubBehaviour.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { status: "Unpaid" } }));
    };
    if (stubBehaviour.delayMs) setTimeout(respond, stubBehaviour.delayMs);
    else respond();
  });

  await new Promise<void>((resolve) => hubtelStub.listen(0, "127.0.0.1", resolve));
  const port = (hubtelStub.address() as AddressInfo).port;

  process.env.HUBTEL_STATUS_API_BASE = `http://127.0.0.1:${port}`;
  process.env.HUBTEL_MERCHANT_NUMBER = "HM0000000";
  process.env.HUBTEL_BASE_URL = `http://127.0.0.1:${port}`;

  const superAdmin = await prisma.user.create({
    data: {
      email: `pg-super-${Date.now()}@example.com`,
      fullName: "Super Admin",
      accountType: AccountType.ADMIN,
      authProvider: AuthProvider.EMAIL,
      adminProfile: {
        create: { department: AdminDepartment.DIASPORA_AFFAIRS, role: AdminRole.SUPER_ADMIN },
      },
    },
  });
  superAdminId = superAdmin.id;

  // A non-super admin, to prove RBAC is enforced independently of the UI.
  const financeAdmin = await prisma.user.create({
    data: {
      email: `pg-finance-${Date.now()}@example.com`,
      fullName: "Finance Admin",
      accountType: AccountType.ADMIN,
      authProvider: AuthProvider.EMAIL,
      adminProfile: {
        create: { department: AdminDepartment.FINANCE, role: AdminRole.FINANCE },
      },
    },
  });
  financeAdminId = financeAdmin.id;

  controller = new AdminPaymentGatewayController();
});

afterAll(async () => {
  await new Promise<void>((resolve) => hubtelStub.close(() => resolve()));
  delete process.env.HUBTEL_STATUS_API_BASE;

  for (const id of [superAdminId, financeAdminId]) {
    await prisma.adminActivityLog.deleteMany({ where: { actorId: id } });
    await prisma.user.delete({ where: { id } });
  }
  await prisma.paymentGatewayConfig.deleteMany({});
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.paymentGatewayConfig.deleteMany({});
  await prisma.adminActivityLog.deleteMany({ where: { actorId: superAdminId } });
  stubBehaviour = { status: 200 };
  stubSawAuthorization = null;
  _resetPaymentControlCache();
  _resetHubtelClientCache();
});

describe("payment gateway configuration", () => {
  it("reports the environment-variable configuration before any row exists", async () => {
    process.env.HUBTEL_CLIENT_ID = GOOD_CLIENT_ID;
    process.env.HUBTEL_CLIENT_SECRET = GOOD_CLIENT_SECRET;

    const config = await getSanitizedConfig();

    expect(config.credentialSource).toBe("environment");
    expect(config.hasClientId).toBe(true);
    expect(config.hasClientSecret).toBe(true);
    expect(config.environment).toBe("TEST");
    expect(config.connectionStatus).toBe("NOT_CONNECTED");
    expect(config.connected).toBe(false);

    delete process.env.HUBTEL_CLIENT_ID;
    delete process.env.HUBTEL_CLIENT_SECRET;
  });

  it("stores credentials encrypted and never returns them", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: `  ${GOOD_CLIENT_ID}  `,
      clientSecret: GOOD_CLIENT_SECRET,
    });

    const row = await prisma.paymentGatewayConfig.findUniqueOrThrow({
      where: { provider: "HUBTEL" },
    });
    expect(row.clientIdEncrypted).toBeTruthy();
    expect(row.clientIdEncrypted).not.toContain(GOOD_CLIENT_ID);
    expect(row.clientSecretEncrypted).not.toContain(GOOD_CLIENT_SECRET);

    const config = await getSanitizedConfig();
    // The handoff's hard requirement: presence flags only, never a value.
    expect(config).not.toHaveProperty("clientSecret");
    expect(config).not.toHaveProperty("clientId");
    expect(config.hasClientSecret).toBe(true);
    expect(JSON.stringify(config)).not.toContain(GOOD_CLIENT_SECRET);
  });

  it("trims whitespace from the client id", async () => {
    await updateSettings({ actorId: superAdminId, clientId: "  spaced-id  " });
    const config = await getSanitizedConfig();
    expect(config.hasClientId).toBe(true);

    const { resolveRuntimeCredentials } =
      await import("../src/services/payment-gateway-config.service.js");
    const creds = await resolveRuntimeCredentials();
    expect(creds.clientId).toBe("spaced-id");
  });

  it("treats a blank client secret as no change", async () => {
    await updateSettings({ actorId: superAdminId, clientSecret: GOOD_CLIENT_SECRET });

    const outcome = await updateSettings({ actorId: superAdminId, clientSecret: "   " });

    expect(outcome.clientSecretChanged).toBe(false);
    const { resolveRuntimeCredentials } =
      await import("../src/services/payment-gateway-config.service.js");
    expect((await resolveRuntimeCredentials()).clientSecret).toBe(GOOD_CLIENT_SECRET);
  });

  it("treats an omitted client secret as no change", async () => {
    await updateSettings({ actorId: superAdminId, clientSecret: GOOD_CLIENT_SECRET });
    const outcome = await updateSettings({ actorId: superAdminId, clientId: "new-id" });

    expect(outcome.clientSecretChanged).toBe(false);
    const { resolveRuntimeCredentials } =
      await import("../src/services/payment-gateway-config.service.js");
    expect((await resolveRuntimeCredentials()).clientSecret).toBe(GOOD_CLIENT_SECRET);
  });

  it("clears the client secret only when explicitly asked", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });

    const outcome = await updateSettings({ actorId: superAdminId, clearClientSecret: true });

    expect(outcome.clientSecretCleared).toBe(true);
    const config = await getSanitizedConfig();
    expect(config.hasClientSecret).toBe(false);
    expect(config.hasClientId).toBe(true);
  });

  it("refuses to clear the last remaining credential", async () => {
    await updateSettings({ actorId: superAdminId, clientSecret: GOOD_CLIENT_SECRET });

    await expect(
      updateSettings({ actorId: superAdminId, clearClientSecret: true }),
    ).rejects.toThrow(GatewayConfigError);
  });

  it("stores the environment as a single mutually exclusive value", async () => {
    await updateSettings({ actorId: superAdminId, environment: "LIVE" });
    expect((await getSanitizedConfig()).environment).toBe("LIVE");

    await updateSettings({ actorId: superAdminId, environment: "TEST" });
    expect((await getSanitizedConfig()).environment).toBe("TEST");
  });
});

describe("connection test and connect", () => {
  it("does not change connectionStatus when a test succeeds", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });
    stubBehaviour = { status: 200 };

    const outcome = await testConnection({ actorId: superAdminId });

    expect(outcome.success).toBe(true);
    expect(outcome.config.lastTestedAt).not.toBeNull();
    // A passing test is not a connection.
    expect(outcome.config.connectionStatus).toBe("NOT_CONNECTED");
    expect(outcome.config.connected).toBe(false);
  });

  it("tests unsaved in-flight credentials without persisting them", async () => {
    const outcome = await testConnection({
      actorId: superAdminId,
      clientId: "unsaved-id",
      clientSecret: "unsaved-secret",
    });

    expect(outcome.success).toBe(true);
    expect(stubSawAuthorization).toContain(
      Buffer.from("unsaved-id:unsaved-secret").toString("base64"),
    );
    // Nothing was written.
    expect(await prisma.paymentGatewayConfig.count()).toBe(0);
  });

  it("reports rejected credentials without leaking the secret", async () => {
    stubBehaviour = { status: 401 };

    const outcome = await testConnection({
      actorId: superAdminId,
      clientId: "bad-id",
      clientSecret: "bad-secret",
    });

    expect(outcome.success).toBe(false);
    expect(outcome.retryable).toBe(false);
    expect(outcome.message).not.toContain("bad-secret");
    expect(outcome.message).toMatch(/rejected these credentials/i);
  });

  it("marks the gateway connected only after a successful probe", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });
    stubBehaviour = { status: 200 };

    const outcome = await connect({ actorId: superAdminId });

    expect(outcome.connected).toBe(true);
    expect(outcome.config.connectionStatus).toBe("CONNECTED");
    expect(outcome.config.connectedEnvironment).toBe("TEST");
    expect(outcome.config.connected).toBe(true);
    expect(outcome.config.lastConnectedAt).not.toBeNull();
  });

  it("records an error state when the probe is rejected", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });
    stubBehaviour = { status: 401 };

    const outcome = await connect({ actorId: superAdminId });

    expect(outcome.connected).toBe(false);
    expect(outcome.config.connectionStatus).toBe("ERROR");
    expect(outcome.config.connected).toBe(false);
    expect(outcome.config.lastErrorCategory).toBe("invalid_credentials");
  });

  it("treats a non-401 response as proof the credentials were accepted", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });
    // The probe reference cannot exist, so a 404 is the expected healthy reply.
    stubBehaviour = { status: 404 };

    expect((await connect({ actorId: superAdminId })).connected).toBe(true);
  });

  it("marks the connection stale when the environment changes", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });
    stubBehaviour = { status: 200 };
    await connect({ actorId: superAdminId });
    expect((await getSanitizedConfig()).connected).toBe(true);

    await updateSettings({ actorId: superAdminId, environment: "LIVE" });

    const config = await getSanitizedConfig();
    expect(config.environment).toBe("LIVE");
    // The TEST verification must not count as a LIVE connection.
    expect(config.connected).toBe(false);
    expect(await isConnectionSatisfied()).toBe(false);
  });
});

describe("payment processing switch", () => {
  it("refuses to enable processing while the gateway is unconnected", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });

    await expect(setProcessingEnabled({ actorId: superAdminId, enabled: true })).rejects.toThrow(
      /cannot be enabled/i,
    );
    expect((await getSanitizedConfig()).paymentProcessingEnabled).toBe(false);
  });

  it("allows enabling once connected", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });
    stubBehaviour = { status: 200 };
    await connect({ actorId: superAdminId });

    const outcome = await setProcessingEnabled({ actorId: superAdminId, enabled: true });
    expect(outcome.paymentProcessingEnabled).toBe(true);
  });

  it("always allows disabling, even when unhealthy", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });
    stubBehaviour = { status: 200 };
    await connect({ actorId: superAdminId });
    await setProcessingEnabled({ actorId: superAdminId, enabled: true });

    stubBehaviour = { status: 401 };
    await connect({ actorId: superAdminId });

    const outcome = await setProcessingEnabled({
      actorId: superAdminId,
      enabled: false,
      reason: "Provider outage",
    });
    expect(outcome.paymentProcessingEnabled).toBe(false);
    expect(outcome.config.processingDisabledReason).toBe("Provider outage");
  });

  it("auto-disables processing when credentials change", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });
    stubBehaviour = { status: 200 };
    await connect({ actorId: superAdminId });
    await setProcessingEnabled({ actorId: superAdminId, enabled: true });

    const outcome = await updateSettings({
      actorId: superAdminId,
      clientSecret: "rotated-secret",
    });

    expect(outcome.processingAutoDisabled).toBe(true);
    const config = await getSanitizedConfig();
    expect(config.paymentProcessingEnabled).toBe(false);
    expect(config.connectionStatus).toBe("NOT_CONNECTED");
    expect(config.connectedEnvironment).toBeNull();
  });

  it("auto-disables processing when the environment changes", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });
    stubBehaviour = { status: 200 };
    await connect({ actorId: superAdminId });
    await setProcessingEnabled({ actorId: superAdminId, enabled: true });

    // Switching TEST -> LIVE must not leave money movement enabled against a
    // connection that was verified for a different environment.
    const outcome = await updateSettings({
      actorId: superAdminId,
      environment: "LIVE",
    });

    expect(outcome.processingAutoDisabled).toBe(true);
    const config = await getSanitizedConfig();
    expect(config.paymentProcessingEnabled).toBe(false);
    expect(config.connected).toBe(false);
    // The verification record itself is preserved, but scoped to the old
    // environment, so it is no longer effective.
    expect(config.connectionStatus).toBe("CONNECTED");
    expect(config.connectedEnvironment).toBe("TEST");
  });

  it("reports the auto-disable reason that actually fired", async () => {
    const logs: string[] = [];
    // The logger emits structured JSON via console.warn; capture it so we can
    // assert an environment-only auto-disable is not mislabelled as a
    // credential change.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    try {
      await updateSettings({
        actorId: superAdminId,
        clientId: GOOD_CLIENT_ID,
        clientSecret: GOOD_CLIENT_SECRET,
      });
      stubBehaviour = { status: 200 };
      await connect({ actorId: superAdminId });
      await setProcessingEnabled({ actorId: superAdminId, enabled: true });

      // Credentials unchanged, environment changed.
      await updateSettings({ actorId: superAdminId, environment: "LIVE" });

      const autoDisabled = logs
        .join("")
        .split("\n")
        .filter((line) => line.includes("processing_auto_disabled"))
        .join("");

      expect(autoDisabled).not.toBe("");
      expect(autoDisabled).toContain('"reason":"environment_changed"');
      expect(autoDisabled).not.toContain('"reason":"credentials_changed"');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("audit trail", () => {
  it("records a credential change without the secret", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });

    const log = await prisma.adminActivityLog.findFirstOrThrow({
      where: { actorId: superAdminId, entityType: "PAYMENT_GATEWAY" },
      orderBy: { createdAt: "desc" },
    });

    expect(log.action).toBe("CREDENTIALS_UPDATED");
    expect(JSON.stringify(log)).not.toContain(GOOD_CLIENT_SECRET);
    expect(JSON.stringify(log)).not.toContain(GOOD_CLIENT_ID);
    expect((log.metadata as Record<string, unknown>).credentials).toBeDefined();
  });

  it("records the environment transition in metadata", async () => {
    await updateSettings({ actorId: superAdminId, environment: "LIVE" });

    const log = await prisma.adminActivityLog.findFirstOrThrow({
      where: { actorId: superAdminId, entityType: "PAYMENT_GATEWAY" },
      orderBy: { createdAt: "desc" },
    });

    expect((log.metadata as Record<string, unknown>).environment).toEqual({
      from: "TEST",
      to: "LIVE",
    });
  });
});

describe("controller responses", () => {
  it("never includes a secret in the settings response", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });

    const { res, json } = createMockRes();
    const req = { user: { id: superAdminId }, requestId: "req-1" } as unknown as Request;
    await controller.getSettings(req, res);

    const payload = JSON.stringify(json.mock.calls[0][0]);
    expect(payload).not.toContain(GOOD_CLIENT_SECRET);
    expect(payload).not.toContain('clientSecret":');
    expect(json.mock.calls[0][0].data.hasClientSecret).toBe(true);
  });

  it("returns 409 with an actionable message when enabling while disconnected", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });

    const { res, json, status } = createMockRes();
    const req = {
      user: { id: superAdminId },
      requestId: "req-2",
      body: { enabled: true },
    } as unknown as Request;
    await controller.setProcessing(req, res);

    expect(status).toHaveBeenCalledWith(409);
    expect(json.mock.calls[0][0].error.code).toBe("GATEWAY_NOT_CONNECTED");
    expect(json.mock.calls[0][0].error.message).toMatch(/Connect/i);
  });

  it("returns 502 with server-derived status when connect fails", async () => {
    await updateSettings({
      actorId: superAdminId,
      clientId: GOOD_CLIENT_ID,
      clientSecret: GOOD_CLIENT_SECRET,
    });
    stubBehaviour = { status: 401 };

    const { res, json, status } = createMockRes();
    const req = { user: { id: superAdminId }, requestId: "req-3" } as unknown as Request;
    await controller.connect(req, res);

    expect(status).toHaveBeenCalledWith(502);
    expect(json.mock.calls[0][0].data.connectionStatus).toBe("ERROR");
  });

  it("rejects an environment change without the environment permission", async () => {
    const { res, json, status } = createMockRes();
    const req = {
      user: { id: financeAdminId },
      requestId: "req-4",
      body: { environment: "LIVE" },
    } as unknown as Request;
    await controller.updateSettings(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json.mock.calls[0][0].error.code).toBe("INSUFFICIENT_PERMISSION");
  });
});
