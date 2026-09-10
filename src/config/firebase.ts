import { readFileSync } from "node:fs";
import { initializeApp, cert, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

const SERVICE_ACCOUNT_PATH = "/etc/secrets/firebase-service-account.json";

let firebaseApp: App | null = null;
let messaging: Messaging | null = null;

/**
 * Normalize a private key read from an env var into a parseable PEM. The key is
 * frequently pasted into dashboards in a form the PEM decoder rejects:
 *   - wrapped in the surrounding JSON quotes ("..."),
 *   - with JSON-escaped newlines (single or double-escaped \n / \r),
 *   - collapsed onto a single line (no line breaks at all in the body).
 * This resolves all of those so the stored value is never a decode failure.
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw;

  for (let i = 0; i < 2 && key.includes("\\"); i++) {
    key = key.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
  }
  key = key.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (key.trim().startsWith('"') && key.trim().endsWith('"')) {
    key = key.trim().slice(1, -1);
  }
  key = key.trim();

  const match = key.match(/^(-----BEGIN [A-Z ]+-----)([\s\S]*?)(-----END [A-Z ]+-----)$/);
  if (match && !match[2].includes("\n")) {
    const body = match[2].replace(/\s/g, "");
    key = `${match[1]}\n${(body.match(/.{1,64}/g) ?? [body]).join("\n")}\n${match[3]}`;
  }

  return key;
}

/**
 * Load Firebase credentials from JSON file or environment variables.
 * JSON file at /etc/secrets/firebase-service-account.json is tried first (Render Secret Files).
 * Falls back to individual FIREBASE_* env vars for backward compatibility.
 */
function loadCredentials(): { projectId: string; privateKey: string; clientEmail: string } | null {
  // Try JSON service account file first
  try {
    const raw = readFileSync(SERVICE_ACCOUNT_PATH, "utf8");
    const sa = JSON.parse(raw);
    if (sa.project_id && sa.private_key && sa.client_email) {
      return {
        projectId: sa.project_id,
        privateKey: sa.private_key,
        clientEmail: sa.client_email,
      };
    }
    console.warn("[push] Service account JSON missing required fields, falling back to env vars");
  } catch {
    // File not found or invalid — fall through to env vars
  }

  // Fall back to environment variables
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (projectId && rawPrivateKey && clientEmail) {
    return { projectId, privateKey: normalizePrivateKey(rawPrivateKey), clientEmail };
  }

  return null;
}

/**
 * Initialize Firebase Admin SDK. Called once during server startup.
 * No-op when credentials are missing — push notifications are silently skipped.
 */
export function initFirebase(): void {
  const creds = loadCredentials();

  if (!creds) {
    console.warn("[push] Firebase not configured — no service-account file or FIREBASE_* env vars found");
    return;
  }

  try {
    firebaseApp = initializeApp({
      credential: cert(creds),
    });
    messaging = getMessaging(firebaseApp);
    console.log(`[push] Firebase Admin initialized for project ${creds.projectId}`);
  } catch (error) {
    console.error("[push] Firebase initialization failed", error);
  }
}

/**
 * Get the Firebase Messaging instance. Returns null when Firebase is not configured.
 */
export function getFirebaseMessaging(): Messaging | null {
  return messaging;
}

/**
 * True when Firebase has been initialized and is ready to send messages.
 */
export function isFirebaseConfigured(): boolean {
  return messaging !== null;
}
