import { initializeApp, cert, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

let firebaseApp: App | null = null;
let messaging: Messaging | null = null;

/**
 * Initialize Firebase Admin SDK. Called once during server startup.
 * No-op when env vars are missing — push notifications are silently skipped.
 */
export function initFirebase(): void {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (!projectId || !privateKey || !clientEmail) {
    console.warn("[push] Firebase not configured — push notifications disabled");
    return;
  }

  try {
    firebaseApp = initializeApp({
      credential: cert({
        projectId,
        privateKey: privateKey.replace(/\\n/g, "\n"),
        clientEmail,
      }),
    });
    messaging = getMessaging(firebaseApp);
    console.log("[push] Firebase Admin initialized");
  } catch (error) {
    console.error("[push] Firebase initialization failed:", error);
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
