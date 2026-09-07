import { initializeApp, cert, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

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
 * Initialize Firebase Admin SDK. Called once during server startup.
 * No-op when env vars are missing — push notifications are silently skipped.
 */
export function initFirebase(): void {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  const missing: string[] = [];
  if (!projectId) missing.push("FIREBASE_PROJECT_ID");
  if (!rawPrivateKey) missing.push("FIREBASE_PRIVATE_KEY");
  if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");

  if (missing.length > 0) {
    console.warn(`[push] Firebase not configured — missing: ${missing.join(", ")}`);
    return;
  }

  const privateKey = normalizePrivateKey(rawPrivateKey!);

  try {
    firebaseApp = initializeApp({
      credential: cert({
        projectId: projectId!,
        privateKey,
        clientEmail: clientEmail!,
      }),
    });
    messaging = getMessaging(firebaseApp);
    console.log("[push] Firebase Admin initialized");
  } catch (error) {
    const startsPem = privateKey.startsWith("-----BEGIN");
    const hasNewline = privateKey.includes("\n");
    const isMultiLine = privateKey.split("\n").filter(Boolean).length > 1;
    console.error(
      `[push] Firebase initialization failed — private key ${startsPem ? "" : "NOT "}PEM-formatted, ` +
        `newlines ${hasNewline ? "present" : "absent"}, body lines: ${isMultiLine ? "wrapped" : "single-line"}. ` +
        "Ensure FIREBASE_PRIVATE_KEY contains the full service-account PEM key (begin/end markers included, " +
        "no surrounding quotes).",
      error,
    );
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
