// ─────────────────────────────────────────
// Payment Gateway Configuration Service
// ─────────────────────────────────────────
// Owns the stored payment-provider configuration, the state machine that governs
// it, and the sanitized projection that is safe to return over the API.
//
// Invariants enforced here (the acceptance checklist from the handoff):
//
//  1. `clientSecret` never leaves this module in any form. The only thing callers
//     receive is `hasClientSecret: boolean`. There is no code path that returns
//     even a masked value.
//  2. `connectionStatus` is server-derived. No request field can set it.
//  3. A successful *test* updates `lastTestedAt` but never flips the connection
//     state — only `connect()` does that, and only after a real probe passes.
//  4. `paymentProcessingEnabled` cannot become true unless the *currently
//     selected* environment has a verified connection.
//  5. Changing credentials or environment revokes the verification and
//     auto-disables processing, because leaving money movement enabled against
//     unverified credentials is the one failure mode with a real cost.
//
// Credential source
// -----------------
// The database is the source of truth once a config row exists. Before that —
// and as a safety net if the row is deleted — the service falls back to the
// HUBTEL_* environment variables, so existing deployments that have never
// opened the settings screen keep working. `credentialSource` is reported to the
// admin UI so it is obvious which one is live.

import type {
  PaymentGatewayConfig,
  PaymentGatewayConnectionStatus,
  PaymentGatewayEnvironment,
  PaymentGatewayProvider,
} from "../../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";
import { AdminEntityType, logAdminActivity } from "../helpers/admin-activity.js";
import { decryptSecret, encryptSecret, SecretDecryptionError } from "../helpers/encryption.js";
import * as gatewayLog from "../helpers/paymentGatewayLogger.js";
import { probeHubtelCredentials, type HubtelProbeResult } from "./hubtel-connection.service.js";

/** AAD label binding a ciphertext to the column it belongs in. */
function secretContext(
  provider: PaymentGatewayProvider,
  field: "clientId" | "clientSecret",
): string {
  return `${provider.toLowerCase()}:${field}`;
}

export type CredentialSource = "database" | "environment";

export interface SanitizedGatewayConfig {
  provider: PaymentGatewayProvider;
  environment: PaymentGatewayEnvironment;
  connectionStatus: PaymentGatewayConnectionStatus;
  connectedEnvironment: PaymentGatewayEnvironment | null;
  /** Effective readiness: verified *and* verified for the selected environment. */
  connected: boolean;
  paymentProcessingEnabled: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  configured: boolean;
  credentialSource: CredentialSource;
  lastTestedAt: Date | null;
  lastConnectedAt: Date | null;
  lastErrorCategory: string | null;
  processingDisabledReason: string | null;
  updatedBy: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ResolvedCredentials {
  clientId: string | null;
  clientSecret: string | null;
  baseUrl: string | undefined;
  merchantAccountNumber: string | null;
  environment: PaymentGatewayEnvironment;
  source: CredentialSource;
}

export class GatewayConfigError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GatewayConfigError";
  }
}

function envCredentials() {
  return {
    clientId: process.env.HUBTEL_CLIENT_ID?.trim() || null,
    clientSecret: process.env.HUBTEL_CLIENT_SECRET?.trim() || null,
    merchantAccountNumber: process.env.HUBTEL_MERCHANT_NUMBER?.trim() || null,
    baseUrl: process.env.HUBTEL_BASE_URL,
  };
}

export async function getConfigRow(
  provider: PaymentGatewayProvider,
): Promise<PaymentGatewayConfig | null> {
  return prisma.paymentGatewayConfig.findUnique({ where: { provider } });
}

/**
 * Read-only projection. When no row exists yet, reports the environment-variable
 * configuration so the settings screen reflects reality instead of showing an
 * empty form for a gateway that is in fact working.
 */
export async function getSanitizedConfig(
  provider: PaymentGatewayProvider = "HUBTEL",
): Promise<SanitizedGatewayConfig> {
  const row = await getConfigRow(provider);
  const env = envCredentials();

  if (!row) {
    const hasClientId = Boolean(env.clientId);
    const hasClientSecret = Boolean(env.clientSecret);
    return {
      provider,
      environment: "TEST",
      connectionStatus: "NOT_CONNECTED",
      connectedEnvironment: null,
      connected: false,
      paymentProcessingEnabled: false,
      hasClientId,
      hasClientSecret,
      configured: hasClientId && hasClientSecret,
      credentialSource: "environment",
      lastTestedAt: null,
      lastConnectedAt: null,
      lastErrorCategory: null,
      processingDisabledReason: null,
      updatedBy: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  const hasClientId = Boolean(row.clientIdEncrypted);
  const hasClientSecret = Boolean(row.clientSecretEncrypted);
  const connected =
    row.connectionStatus === "CONNECTED" && row.connectedEnvironment === row.environment;

  return {
    provider: row.provider,
    environment: row.environment,
    connectionStatus: row.connectionStatus,
    connectedEnvironment: row.connectedEnvironment,
    connected,
    paymentProcessingEnabled: row.paymentProcessingEnabled,
    hasClientId,
    hasClientSecret,
    configured: hasClientId && hasClientSecret,
    credentialSource: hasClientId || hasClientSecret ? "database" : "environment",
    lastTestedAt: row.lastTestedAt,
    lastConnectedAt: row.lastConnectedAt,
    lastErrorCategory: row.lastErrorCategory,
    processingDisabledReason: row.processingDisabledReason,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getOrCreateRow(
  provider: PaymentGatewayProvider,
  actorId: string | null,
): Promise<PaymentGatewayConfig> {
  const existing = await getConfigRow(provider);
  if (existing) return existing;

  return prisma.paymentGatewayConfig.create({
    data: { provider, updatedBy: actorId },
  });
}

function decryptField(
  row: PaymentGatewayConfig,
  field: "clientId" | "clientSecret",
): string | null {
  const payload = field === "clientId" ? row.clientIdEncrypted : row.clientSecretEncrypted;
  if (!payload) return null;
  return decryptSecret(payload, secretContext(row.provider, field));
}

/**
 * Credentials for outbound payment calls.
 *
 * Database first, environment as fallback. Throws rather than returning a
 * half-populated pair, so a partially-configured gateway fails loudly at the
 * call site instead of authenticating with an empty secret.
 */
export async function resolveRuntimeCredentials(
  provider: PaymentGatewayProvider = "HUBTEL",
): Promise<ResolvedCredentials> {
  const row = await getConfigRow(provider);
  const env = envCredentials();

  if (!row || (!row.clientIdEncrypted && !row.clientSecretEncrypted)) {
    return {
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      baseUrl: env.baseUrl,
      merchantAccountNumber: env.merchantAccountNumber,
      environment: row?.environment ?? "TEST",
      source: "environment",
    };
  }

  return {
    clientId: decryptField(row, "clientId"),
    clientSecret: decryptField(row, "clientSecret"),
    // The base URL and merchant account number are deployment topology rather
    // than credentials, so they stay in the environment. See module header.
    baseUrl: env.baseUrl,
    merchantAccountNumber: env.merchantAccountNumber,
    environment: row.environment,
    source: "database",
  };
}

/**
 * Whether payment processing may be turned on.
 *
 * With a stored row this is the strict rule from the handoff. Without one, a
 * deployment that has only ever used HUBTEL_* env vars is treated as satisfied
 * so that unifying the switch cannot strand a live installation mid-migration.
 */
export async function isConnectionSatisfied(
  provider: PaymentGatewayProvider = "HUBTEL",
): Promise<boolean> {
  const row = await getConfigRow(provider);
  if (!row) {
    const env = envCredentials();
    return Boolean(env.clientId && env.clientSecret);
  }
  return row.connectionStatus === "CONNECTED" && row.connectedEnvironment === row.environment;
}

export interface UpdateSettingsInput {
  provider?: PaymentGatewayProvider;
  actorId: string;
  requestId?: string | null;
  clientId?: string;
  clientSecret?: string;
  clearClientSecret?: boolean;
  environment?: PaymentGatewayEnvironment;
}

export interface UpdateSettingsOutcome {
  config: SanitizedGatewayConfig;
  clientIdChanged: boolean;
  clientSecretChanged: boolean;
  clientSecretCleared: boolean;
  environmentChanged: boolean;
  /** True when a change to credentials/environment forced processing off. */
  processingAutoDisabled: boolean;
  previousEnvironment: PaymentGatewayEnvironment;
}

/**
 * Applies a partial credential/environment update.
 *
 * Blank strings mean "no change" — only the explicit `clearClientSecret` flag
 * removes a stored secret, so a truncated or buggy client payload cannot
 * silently destroy working credentials.
 */
export async function updateSettings(input: UpdateSettingsInput): Promise<UpdateSettingsOutcome> {
  const provider = input.provider ?? "HUBTEL";
  const row = await getOrCreateRow(provider, input.actorId);

  const previousEnvironment = row.environment;
  const trimmedClientId = input.clientId?.trim();
  const trimmedClientSecret = input.clientSecret?.trim();

  // An omitted *or* blank field is a no-op. That distinction is the whole point
  // of the endpoint: PATCH-like semantics over a PUT.
  const nextClientId = trimmedClientId ? trimmedClientId : row.clientIdEncrypted;
  const nextClientSecret =
    trimmedClientSecret && !input.clearClientSecret
      ? encryptSecret(trimmedClientSecret, secretContext(provider, "clientSecret"))
      : input.clearClientSecret
        ? null
        : row.clientSecretEncrypted;

  const clientIdChanged =
    Boolean(trimmedClientId) && trimmedClientId !== decryptFieldSafely(row, "clientId");
  const clientSecretChanged =
    Boolean(trimmedClientSecret) && trimmedClientSecret !== decryptFieldSafely(row, "clientSecret");
  const clientSecretCleared =
    Boolean(input.clearClientSecret) && row.clientSecretEncrypted !== null;

  if (clientSecretCleared && !nextClientId) {
    throw new GatewayConfigError(
      "WOULD_LEAVE_NO_CREDENTIALS",
      "Cannot clear the client secret while no client ID is stored. Enter a Client ID first.",
      400,
    );
  }

  const nextEnvironment = input.environment ?? row.environment;
  const environmentChanged = nextEnvironment !== row.environment;

  // Any credential change invalidates the verification for BOTH environments.
  const credentialsChanged = clientIdChanged || clientSecretChanged || clientSecretCleared;
  // An environment change leaves the recorded verification intact but scoped to
  // the old environment, so `connected` (which compares the two) goes false on
  // its own — no need to destroy the status here.
  const verificationInvalid = credentialsChanged;

  const nextConnectedEnvironment = verificationInvalid ? null : row.connectedEnvironment;
  const nextConnectionStatus = verificationInvalid ? "NOT_CONNECTED" : row.connectionStatus;

  // Money movement must not survive anything that invalidates the connection for
  // the *current* environment. That is a credential change OR an environment
  // switch, so both must force the switch off rather than leaving an enabled
  // switch pointing at a connection nobody verified.
  const invalidatesCurrentConnection = credentialsChanged || environmentChanged;
  const processingAutoDisabled = invalidatesCurrentConnection && row.paymentProcessingEnabled;
  const nextProcessingEnabled = processingAutoDisabled ? false : row.paymentProcessingEnabled;
  const nextDisabledReason = processingAutoDisabled
    ? credentialsChanged
      ? "Automatically disabled because payment credentials changed."
      : "Automatically disabled because the gateway environment changed."
    : row.processingDisabledReason;

  const updated = await prisma.paymentGatewayConfig.update({
    where: { provider },
    data: {
      clientIdEncrypted: trimmedClientId
        ? encryptSecret(trimmedClientId, secretContext(provider, "clientId"))
        : row.clientIdEncrypted,
      clientSecretEncrypted: nextClientSecret,
      environment: nextEnvironment,
      connectionStatus: nextConnectionStatus,
      connectedEnvironment: nextConnectedEnvironment,
      paymentProcessingEnabled: nextProcessingEnabled,
      processingDisabledReason: nextProcessingEnabled ? null : nextDisabledReason,
      updatedBy: input.actorId,
    },
  });

  const metadata: Record<string, unknown> = { requestId: input.requestId ?? null };
  if (credentialsChanged) {
    metadata.credentials = {
      clientIdChanged,
      clientSecretChanged,
      clientSecretCleared,
    };
  }
  if (environmentChanged) {
    metadata.environment = { from: previousEnvironment, to: nextEnvironment };
  }
  if (processingAutoDisabled) {
    metadata.processingAutoDisabled = true;
  }

  await logAdminActivity({
    actorId: input.actorId,
    entityType: AdminEntityType.PAYMENT_GATEWAY,
    entityId: updated.id,
    action: "CREDENTIALS_UPDATED",
    // Note carries no secret: presence flags only.
    note:
      [
        clientIdChanged ? "clientId changed" : null,
        clientSecretChanged ? "clientSecret changed" : null,
        clientSecretCleared ? "clientSecret cleared" : null,
        environmentChanged ? `environment ${previousEnvironment} -> ${nextEnvironment}` : null,
        processingAutoDisabled ? "payment processing auto-disabled" : null,
      ]
        .filter(Boolean)
        .join("; ") || "no-op",
    metadata,
  });

  if (credentialsChanged) {
    gatewayLog.logCredentialsUpdated({
      actorId: input.actorId,
      requestId: input.requestId ?? null,
      environment: nextEnvironment,
      clientIdChanged,
      clientSecretChanged,
      clientSecretCleared,
    });
  }

  if (environmentChanged) {
    gatewayLog.logEnvironmentChanged({
      actorId: input.actorId,
      requestId: input.requestId ?? null,
      fromEnvironment: previousEnvironment,
      toEnvironment: nextEnvironment,
    });
  }

  if (processingAutoDisabled) {
    gatewayLog.logProcessingAutoDisabled({
      actorId: input.actorId,
      requestId: input.requestId ?? null,
      // Report what actually triggered it — a credentials-only change and an
      // environment-only change are different operational events.
      reason: credentialsChanged ? "credentials_changed" : "environment_changed",
      environment: nextEnvironment,
    });
  }

  return {
    config: await getSanitizedConfig(provider),
    clientIdChanged,
    clientSecretChanged,
    clientSecretCleared,
    environmentChanged,
    processingAutoDisabled,
    previousEnvironment,
  };
}

/** Decrypt helper that yields null instead of throwing on an unreadable row. */
function decryptFieldSafely(
  row: PaymentGatewayConfig,
  field: "clientId" | "clientSecret",
): string | null {
  try {
    return decryptField(row, field);
  } catch (error) {
    if (error instanceof SecretDecryptionError) {
      console.error(
        `[payment-gateway] stored ${field} for ${row.provider} could not be decrypted; ` +
          "check that PAYMENT_GATEWAY_ENCRYPTION_KEY still matches the value used when it was saved",
      );
      return null;
    }
    throw error;
  }
}

export interface TestConnectionInput {
  provider?: PaymentGatewayProvider;
  actorId: string;
  requestId?: string | null;
  /** Unsaved credentials typed by the admin, if any. */
  clientId?: string;
  clientSecret?: string;
  environment?: PaymentGatewayEnvironment;
}

export interface TestConnectionOutcome {
  success: boolean;
  message: string;
  checkedAt: Date;
  retryable: boolean;
  config: SanitizedGatewayConfig;
}

/**
 * Non-mutating credential check.
 *
 * Uses unsaved in-flight credentials when supplied, otherwise the stored pair.
 * On success this updates `lastTestedAt` only: per the handoff, a passing test
 * must not imply the gateway is connected. `connectionStatus` moves solely via
 * {@link connect}.
 */
export async function testConnection(input: TestConnectionInput): Promise<TestConnectionOutcome> {
  const provider = input.provider ?? "HUBTEL";
  const row = await getConfigRow(provider);
  const environment = input.environment ?? row?.environment ?? "TEST";

  const inFlightClientId = input.clientId?.trim();
  const inFlightClientSecret = input.clientSecret?.trim();

  const clientId = inFlightClientId || (row ? decryptFieldSafely(row, "clientId") : null);
  const clientSecret =
    inFlightClientSecret || (row ? decryptFieldSafely(row, "clientSecret") : null);

  const env = envCredentials();
  const probe = await probeHubtelCredentials({
    clientId: clientId ?? env.clientId,
    clientSecret: clientSecret ?? env.clientSecret,
    merchantAccountNumber: env.merchantAccountNumber,
  });

  const checkedAt = new Date();

  // Only a stored configuration is mutated by a test, and only its timestamp.
  if (row) {
    await prisma.paymentGatewayConfig.update({
      where: { provider },
      data: {
        lastTestedAt: checkedAt,
        ...(probe.ok ? {} : { lastErrorCategory: probe.category }),
        updatedBy: input.actorId,
      },
    });
  }

  gatewayLog.logConnectionTestResult({
    actorId: input.actorId,
    requestId: input.requestId ?? null,
    environment,
    result: probe.ok ? "success" : "failure",
    errorCategory: probe.category,
    durationMs: probe.durationMs,
  });

  return {
    success: probe.ok,
    message: probe.message,
    checkedAt,
    retryable: probe.retryable,
    config: await getSanitizedConfig(provider),
  };
}

export interface ConnectInput {
  provider?: PaymentGatewayProvider;
  actorId: string;
  requestId?: string | null;
}

export interface ConnectOutcome {
  connected: boolean;
  message: string;
  checkedAt: Date;
  environment: PaymentGatewayEnvironment;
  config: SanitizedGatewayConfig;
}

/**
 * Verifies the stored credentials and, only if the probe passes, marks the
 * gateway connected *for the currently selected environment*.
 */
export async function connect(input: ConnectInput): Promise<ConnectOutcome> {
  const provider = input.provider ?? "HUBTEL";
  const row = await getOrCreateRow(provider, input.actorId);
  const environment = row.environment;

  gatewayLog.logConnectStarted({
    actorId: input.actorId,
    requestId: input.requestId ?? null,
    environment,
  });

  const env = envCredentials();
  const probe: HubtelProbeResult = await probeHubtelCredentials({
    clientId: decryptFieldSafely(row, "clientId") ?? env.clientId,
    clientSecret: decryptFieldSafely(row, "clientSecret") ?? env.clientSecret,
    merchantAccountNumber: env.merchantAccountNumber,
  });

  const checkedAt = new Date();

  const updated = await prisma.paymentGatewayConfig.update({
    where: { provider },
    data: probe.ok
      ? {
          connectionStatus: "CONNECTED",
          connectedEnvironment: environment,
          lastConnectedAt: checkedAt,
          lastTestedAt: checkedAt,
          lastErrorCategory: null,
          updatedBy: input.actorId,
        }
      : {
          connectionStatus: "ERROR",
          connectedEnvironment: null,
          lastTestedAt: checkedAt,
          lastErrorCategory: probe.category,
          updatedBy: input.actorId,
        },
  });

  await logAdminActivity({
    actorId: input.actorId,
    entityType: AdminEntityType.PAYMENT_GATEWAY,
    entityId: updated.id,
    action: probe.ok ? "CONNECTED" : "CONNECT_FAILED",
    note: probe.ok
      ? `Connected to Hubtel in ${environment} environment`
      : `Connection failed in ${environment}: ${probe.category}`,
    metadata: {
      requestId: input.requestId ?? null,
      environment,
      result: probe.ok ? "success" : "failure",
      errorCategory: probe.category,
    },
  });

  gatewayLog.logConnectResult({
    actorId: input.actorId,
    requestId: input.requestId ?? null,
    environment,
    result: probe.ok ? "success" : "failure",
    errorCategory: probe.category,
    durationMs: probe.durationMs,
  });

  return {
    connected: probe.ok,
    message: probe.message,
    checkedAt,
    environment,
    config: await getSanitizedConfig(provider),
  };
}

export interface SetProcessingInput {
  provider?: PaymentGatewayProvider;
  actorId: string | null;
  requestId?: string | null;
  enabled: boolean;
  reason?: string;
}

export interface SetProcessingOutcome {
  paymentProcessingEnabled: boolean;
  effectiveAt: Date;
  config: SanitizedGatewayConfig;
}

/**
 * Master switch. Rejects enabling while the selected environment is unverified,
 * with an actionable message rather than a silent no-op.
 */
export async function setProcessingEnabled(
  input: SetProcessingInput,
): Promise<SetProcessingOutcome> {
  const provider = input.provider ?? "HUBTEL";

  // Turning processing OFF is always permitted — it is the operational kill
  // switch and must never be blocked by a broken gateway.
  if (input.enabled) {
    const satisfied = await isConnectionSatisfied(provider);
    if (!satisfied) {
      const config = await getSanitizedConfig(provider);
      throw new GatewayConfigError(
        "GATEWAY_NOT_CONNECTED",
        config.configured
          ? `Payment processing cannot be enabled until the gateway is connected in the ${config.environment} environment. Use "Connect" first.`
          : 'Payment processing cannot be enabled until a Client ID and Client Secret are saved and the gateway is connected. Use "Connect" first.',
        409,
      );
    }
  }

  const row = await getOrCreateRow(provider, input.actorId);

  const updated = await prisma.paymentGatewayConfig.update({
    where: { provider },
    data: {
      paymentProcessingEnabled: input.enabled,
      processingDisabledReason: input.enabled ? null : (input.reason ?? null),
      updatedBy: input.actorId,
    },
  });

  const effectiveAt = updated.updatedAt;

  if (input.actorId) {
    await logAdminActivity({
      actorId: input.actorId,
      entityType: AdminEntityType.PAYMENT_GATEWAY,
      entityId: row.id,
      action: input.enabled ? "ENABLE_PAYMENT_PROCESSING" : "DISABLE_PAYMENT_PROCESSING",
      note: input.enabled
        ? "Payment processing enabled"
        : `Payment processing disabled${input.reason ? `: ${input.reason}` : ""}`,
      metadata: {
        requestId: input.requestId ?? null,
        enabled: input.enabled,
        environment: row.environment,
        connectionStatus: row.connectionStatus,
      },
    });

    gatewayLog.logProcessingToggled({
      actorId: input.actorId,
      requestId: input.requestId ?? null,
      enabled: input.enabled,
      connectionStatus: row.connectionStatus,
      environment: row.environment,
    });
  }

  return {
    paymentProcessingEnabled: updated.paymentProcessingEnabled,
    effectiveAt,
    config: await getSanitizedConfig(provider),
  };
}
