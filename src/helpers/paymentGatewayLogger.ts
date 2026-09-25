// ─────────────────────────────────────────
// Payment Gateway Settings — Structured Logging
// ─────────────────────────────────────────
// The handoff's analytics section maps to these events. The repository has no
// third-party analytics vendor wired up, so each event is emitted as a single
// JSON line (grep-able, shippable to any collector later) under the
// `payment_gateway.*` namespace.
//
// Unlike the community/call loggers, which take an open-ended context bag, every
// event here takes an explicit, typed parameter list. That is the enforcement
// mechanism: there is no code path by which a client id or client secret can be
// passed to these functions, so a credential cannot reach stdout even by mistake.
// Do not widen these signatures to accept arbitrary fields.

type Environment = "TEST" | "LIVE";
type ConnectionStatus = "NOT_CONNECTED" | "CONNECTED" | "ERROR";
type Result = "success" | "failure";
type ErrorCategory =
  | "invalid_credentials"
  | "network"
  | "timeout"
  | "provider_error"
  | "invalid_credentials_missing"
  | "unknown";

interface Base {
  actorId?: string | null;
  requestId?: string | null;
}

function write(
  level: "log" | "warn" | "error",
  event: string,
  data: Record<string, unknown>,
): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), event, ...data });
  if (level === "warn") console.warn(line);
  else if (level === "error") console.error(line);
  else console.log(line);
}

export function logSettingsViewed(
  input: Base & {
    userRole: string;
    connectionStatus: ConnectionStatus;
    environment: Environment;
  },
): void {
  write("log", "payment_gateway.settings_viewed", { ...input });
}

export function logCredentialsUpdated(
  input: Base & {
    environment: Environment;
    clientIdChanged: boolean;
    clientSecretChanged: boolean;
    clientSecretCleared: boolean;
  },
): void {
  write("log", "payment_gateway.credentials_updated", { ...input });
}

export function logEnvironmentChanged(
  input: Base & {
    fromEnvironment: Environment;
    toEnvironment: Environment;
  },
): void {
  // Environment switches are the highest-risk transition in this feature.
  write("warn", "payment_gateway.environment_changed", { ...input });
}

export function logProcessingAutoDisabled(
  input: Base & {
    reason: "credentials_changed" | "environment_changed";
    environment: Environment;
  },
): void {
  write("warn", "payment_gateway.processing_auto_disabled", { ...input });
}

export function logConnectionTestStarted(input: Base & { environment: Environment }): void {
  write("log", "payment_gateway.connection_test_started", { ...input });
}

export function logConnectionTestResult(
  input: Base & {
    environment: Environment;
    result: Result;
    errorCategory: ErrorCategory | null;
    durationMs: number;
  },
): void {
  write(input.result === "success" ? "log" : "warn", "payment_gateway.connection_test_result", {
    ...input,
  });
}

export function logConnectStarted(input: Base & { environment: Environment }): void {
  write("log", "payment_gateway.connect_started", { ...input });
}

export function logConnectResult(
  input: Base & {
    environment: Environment;
    result: Result;
    errorCategory: ErrorCategory | null;
    durationMs: number;
  },
): void {
  write(input.result === "success" ? "log" : "warn", "payment_gateway.connect_result", {
    ...input,
  });
}

export function logProcessingToggled(
  input: Base & {
    enabled: boolean;
    connectionStatus: ConnectionStatus;
    environment: Environment;
  },
): void {
  // Enabling money movement deserves a warn line; disabling does not.
  write(input.enabled ? "warn" : "log", "payment_gateway.processing_toggled", { ...input });
}
