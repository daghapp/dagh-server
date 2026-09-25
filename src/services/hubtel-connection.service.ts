// ─────────────────────────────────────────
// Hubtel Connection Probe
// ─────────────────────────────────────────
// Answers one question: "are these credentials accepted by Hubtel?" without
// moving money.
//
// How
// ---
// Hubtel's REST API authenticates every request with HTTP Basic auth and has no
// token-exchange or "whoami" endpoint, so there is no dedicated credential-check
// call. This probe issues a read-only lookup against the transaction-status API
// using a client reference that cannot exist:
//
//   GET https://api-txnstatus.hubtel.com/transactions/{merchant}/status
//       ?clientReference=00000000-0000-4000-8000-000000000000
//
// The important property is that Hubtel authorises *before* it validates the
// payload, so the status code alone settles the question:
//
//   401 / 403        -> credentials rejected
//   any other reply  -> credentials were accepted (the reference is simply
//                       unknown, which is the expected outcome)
//
// That rule deliberately does not enumerate Hubtel's codes for "unknown
// reference" — 200, 404 and 400 all prove the auth layer passed, and treating
// them as failures would report healthy credentials as broken.
//
// Safety
// ------
// No request here can create, capture, or reverse a payment: it is a GET against
// a status resource for a reference that was never issued. Credentials appear
// only in the Authorization header — never in the URL, a log line, or an error
// message. Provider response bodies are deliberately not surfaced to callers
// because we cannot rule out echoed credentials in an upstream error payload.

import axios from "axios";
import { randomUUID } from "node:crypto";

const DEFAULT_STATUS_API_BASE = "https://api-txnstatus.hubtel.com";
const PROBE_TIMEOUT_MS = 10_000;

/**
 * Status API host. Overridable so a sandbox/staging host can be targeted, and so
 * the test suite can point the probe at a local stub and exercise the real error
 * mapping instead of mocking axios.
 */
function statusApiBase(): string {
  return (process.env.HUBTEL_STATUS_API_BASE?.trim() || DEFAULT_STATUS_API_BASE).replace(
    /\/+$/,
    "",
  );
}

/** Reference that cannot correspond to a real transaction. */
const IMPOSSIBLE_REFERENCE = "00000000-0000-4000-8000-000000000000";

export type ConnectionErrorCategory =
  | "invalid_credentials"
  | "invalid_credentials_missing"
  | "network"
  | "timeout"
  | "provider_error"
  | "unknown";

export interface HubtelProbeResult {
  ok: boolean;
  category: ConnectionErrorCategory | null;
  /** Safe, non-secret, user-presentable message. Never contains provider bodies. */
  message: string;
  /** Whether the caller may sensibly retry without changing anything. */
  retryable: boolean;
  durationMs: number;
}

export interface HubtelProbeInput {
  clientId: string | null;
  clientSecret: string | null;
  merchantAccountNumber: string | null;
}

/** Human-facing copy for each failure mode. Kept free of provider detail. */
const MESSAGES: Record<ConnectionErrorCategory, string> = {
  invalid_credentials: "Hubtel rejected these credentials. Check the Client ID and Client Secret.",
  invalid_credentials_missing: "Client ID and Client Secret are both required before testing.",
  network: "Could not reach Hubtel. Check network connectivity and try again.",
  timeout: "Hubtel did not respond in time. Try again.",
  provider_error: "Hubtel returned an unexpected response. Try again shortly.",
  unknown: "Could not verify the Hubtel connection. Try again.",
};

/**
 * Performs a non-mutating credential check against Hubtel.
 *
 * Never throws: transport problems are mapped to a retryable result so callers
 * can distinguish "your credentials are wrong" (fix the input) from "Hubtel is
 * unreachable" (retry later) — a distinction the admin UI needs.
 */
export async function probeHubtelCredentials(input: HubtelProbeInput): Promise<HubtelProbeResult> {
  const startedAt = Date.now();
  const finish = (result: Omit<HubtelProbeResult, "durationMs">): HubtelProbeResult => ({
    ...result,
    durationMs: Date.now() - startedAt,
  });

  const clientId = input.clientId?.trim() ?? "";
  const clientSecret = input.clientSecret?.trim() ?? "";
  const merchant = input.merchantAccountNumber?.trim() ?? "";

  if (!clientId || !clientSecret) {
    return finish({
      ok: false,
      category: "invalid_credentials_missing",
      message: MESSAGES.invalid_credentials_missing,
      retryable: false,
    });
  }

  if (!merchant) {
    // The status endpoint is merchant-scoped, so there is nothing to probe
    // against. This is a server configuration gap, not a credential problem.
    return finish({
      ok: false,
      category: "provider_error",
      message:
        "Hubtel merchant account number is not configured on the server, so the connection cannot be verified.",
      retryable: false,
    });
  }

  const url = `${statusApiBase()}/transactions/${encodeURIComponent(merchant)}/status`;

  try {
    const response = await axios.get(url, {
      params: { clientReference: IMPOSSIBLE_REFERENCE },
      auth: { username: clientId, password: clientSecret },
      headers: { Accept: "application/json" },
      timeout: PROBE_TIMEOUT_MS,
      // A distinct reference per call keeps proxy/CDN caches from replaying an
      // earlier response and masking a credential change.
      paramsSerializer: {
        serialize: (params) =>
          `clientReference=${encodeURIComponent(params.clientReference)}&_probe=${randomUUID()}`,
      },
      // The probe intentionally reads the body only to discard it.
      validateStatus: () => true,
    });

    const status = response.status;

    if (status === 401 || status === 403) {
      return finish({
        ok: false,
        category: "invalid_credentials",
        message: MESSAGES.invalid_credentials,
        retryable: false,
      });
    }

    // Auth layer passed. See module header for why every other status is a
    // success and why the response body is not inspected.
    return finish({
      ok: true,
      category: null,
      message: "Hubtel accepted the credentials.",
      retryable: false,
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const code = error.code;

      if (code === "ECONNABORTED" || code === "ETIMEDOUT") {
        return finish({
          ok: false,
          category: "timeout",
          message: MESSAGES.timeout,
          retryable: true,
        });
      }

      const networkCodes = ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "ERR_NETWORK"];
      if (code && networkCodes.includes(code)) {
        return finish({
          ok: false,
          category: "network",
          message: MESSAGES.network,
          retryable: true,
        });
      }
    }

    return finish({
      ok: false,
      category: "unknown",
      message: MESSAGES.unknown,
      retryable: true,
    });
  }
}
