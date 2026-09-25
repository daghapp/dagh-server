/**
 * Hubtel API client construction.
 *
 * Clients are built per call from the stored payment-gateway configuration
 * (database first, HUBTEL_* env vars as fallback) so that rotating credentials
 * from the admin settings screen takes effect without a redeploy.
 *
 * Why this is a factory and not a module-level singleton: the previous
 * implementation froze `process.env` into three `axios.create()` instances at
 * import time, which made it impossible for an administrator to change a
 * credential without restarting the service. Results are memoised for
 * `CACHE_TTL_MS` so a burst of payment calls does not turn into a burst of
 * database reads — the same trade-off the payment control switch already makes.
 *
 * The three exported builders preserve the original call shapes:
 *   - `getHubtelClient()`               -> /items/*, /invoice/*   (HUBTEL_BASE_URL)
 *   - `getHubtelStatusClient()`         -> transaction status API
 *   - `getHubtelDirectMoneyReceive()`   -> MoMo direct money receive
 */
import axios, { type AxiosInstance } from "axios";
import { resolveRuntimeCredentials } from "../services/payment-gateway-config.service.js";

const CACHE_TTL_MS = 10_000;

const DEFAULT_STATUS_API_BASE = "https://api-txnstatus.hubtel.com";
const DIRECT_MONEY_BASE = "https://rmp.hubtel.com";

interface CachedClients {
  client: AxiosInstance;
  statusClient: AxiosInstance;
  directMoneyReceive: AxiosInstance;
  cachedAt: number;
}

let cache: CachedClients | null = null;

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function buildClients(): Promise<CachedClients> {
  const creds = await resolveRuntimeCredentials();

  if (!creds.clientId || !creds.clientSecret) {
    throw new Error(
      "Hubtel credentials are not configured. Save a Client ID and Client Secret in " +
        "Admin > Settings > Payment Gateway, or set HUBTEL_CLIENT_ID and HUBTEL_CLIENT_SECRET.",
    );
  }

  if (!creds.baseUrl) {
    // The previous implementation failed at boot on a missing HUBTEL_BASE_URL.
    // That check cannot stay at import time now that credentials are optional in
    // the environment, but an unset base URL would otherwise produce a confusing
    // relative-URL failure deep inside axios.
    throw new Error("HUBTEL_BASE_URL is not set, so Hubtel API calls have no endpoint to target.");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: basicAuth(creds.clientId, creds.clientSecret),
  };

  return {
    client: axios.create({
      baseURL: creds.baseUrl,
      headers,
      timeout: 15000,
    }),
    statusClient: axios.create({
      baseURL: `${(process.env.HUBTEL_STATUS_API_BASE?.trim() || DEFAULT_STATUS_API_BASE).replace(
        /\/+$/,
        "",
      )}/transactions/${creds.merchantAccountNumber ?? ""}/status`,
      headers,
      timeout: 15000,
    }),
    directMoneyReceive: axios.create({
      baseURL: `${DIRECT_MONEY_BASE}/merchantaccount/merchants/${
        creds.merchantAccountNumber ?? ""
      }/receive/mobilemoney`,
      headers,
      timeout: 15000,
    }),
    cachedAt: Date.now(),
  };
}

async function clients(): Promise<CachedClients> {
  if (cache && Date.now() - cache.cachedAt < CACHE_TTL_MS) return cache;
  cache = await buildClients();
  return cache;
}

/** Main Hubtel client: checkout initiation, invoices, item status. */
export async function getHubtelClient(): Promise<AxiosInstance> {
  return (await clients()).client;
}

/** Transaction status API client. */
export async function getHubtelStatusClient(): Promise<AxiosInstance> {
  return (await clients()).statusClient;
}

/** Mobile-money direct money receive client. */
export async function getHubtelDirectMoneyReceive(): Promise<AxiosInstance> {
  return (await clients()).directMoneyReceive;
}

/**
 * Test helper: drops memoised clients. Also called after a credential change so
 * a new secret takes effect immediately instead of after the TTL.
 */
export function _resetHubtelClientCache(): void {
  cache = null;
}
