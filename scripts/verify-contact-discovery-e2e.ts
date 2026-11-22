// E2E verification script for dating contact matching & discovery.
// Usage:
//   API_URL=https://dagh-server-fo64.onrender.com \
//   TEST_EMAIL=user@example.com \
//   TEST_PASSWORD=YourPass123! \
//   npx tsx scripts/verify-contact-discovery-e2e.ts

const BASE_URL = process.env.API_URL || "http://localhost:5000";

// Sample test contacts — replace with real numbers/emails from your device
const TEST_CONTACTS = [
  { name: "Test Contact 1", phone: "+233501234567", email: "contact1@example.com" },
  { name: "Test Contact 2", phone: "0501234567", email: "contact2@example.com" },
];

let accessToken: string | undefined;

async function api(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = await res.text();
  }

  return { status: res.status, data };
}

async function main() {
  console.log("=== Dating Contact & Discovery E2E Verification ===\n");
  console.log(`Base URL: ${BASE_URL}\n`);

  // ── Step 1: Login ─────────────────────────────────────────────────
  const email = process.env.TEST_EMAIL || "test@example.com";
  const password = process.env.TEST_PASSWORD || "TestPass123!";

  console.log("[1/5] Logging in...");
  const loginRes = await api("POST", "/auth/login", { email, password });
  if (loginRes.status !== 200) {
    console.error("  ✗ Login failed:", loginRes.data);
    console.log("\n  → You may need to register first via POST /auth/register");
    process.exit(1);
  }
  accessToken = loginRes.data.accessToken;
  console.log("  ✓ Logged in, access token received\n");

  // ── Step 2: Sync contacts ─────────────────────────────────────────
  console.log("[2/5] Syncing contacts for dating...");
  const syncRes = await api(
    "POST",
    "/dating/contacts/sync",
    { contacts: TEST_CONTACTS, consent: true },
    accessToken
  );
  if (syncRes.status !== 200) {
    console.error("  ✗ Contact sync failed:", syncRes.data);
    process.exit(1);
  }
  console.log("  ✓ Contacts synced");
  console.log(`    Contact count: ${syncRes.data.contactCount ?? "N/A"}\n`);

  // ── Step 3: Get contact matches ───────────────────────────────────
  console.log("[3/5] Fetching contact matches...");
  const matchesRes = await api("GET", "/dating/contacts/matches", undefined, accessToken);
  if (matchesRes.status !== 200) {
    console.error("  ✗ Contact matches failed:", matchesRes.data);
    process.exit(1);
  }
  const { matches, matchedCount, totalContacts, banner } = matchesRes.data;
  console.log(`  ✓ ${matchedCount} contact(s) on the platform (${totalContacts} total contacts)`);
  console.log(`    Banner: "${banner}"`);
  matches.forEach((m: any) => {
    console.log(`    - ${m.name} (${m.phoneNumber}) dating=${m.hasDatingProfile}`);
  });
  console.log("");

  // ── Step 4: Get recommendations (People You May Know) ─────────────
  console.log("[4/5] Fetching discovery recommendations...");
  const recRes = await api(
    "GET",
    "/dating/recommendations?limit=10&offset=0",
    undefined,
    accessToken
  );
  if (recRes.status === 403) {
    console.log("  ⚠ 403 — KYC verification required for dating discovery.");
    console.log("    Complete verification at /verification/* then retry.");
  } else if (recRes.status !== 200) {
    console.error("  ✗ Recommendations failed:", recRes.data);
    process.exit(1);
  } else {
    const candidates = recRes.data.data ?? [];
    console.log(`  ✓ ${candidates.length} candidate(s) returned`);
    candidates.forEach((c: any) => {
      const tag = c.isContactMatch ? " [CONTACT]" : "";
      console.log(`    - ${c.fullName}${tag} (${c.relationshipStatus})`);
    });
  }
  console.log("");

  // ── Step 5: Contact-only recommendations ──────────────────────────
  console.log("[5/5] Fetching contact-only recommendations...");
  const contactOnlyRes = await api(
    "GET",
    "/dating/recommendations?contactsOnly=true&limit=10",
    undefined,
    accessToken
  );
  if (contactOnlyRes.status === 403) {
    console.log("  ⚠ 403 — KYC required for contact-only discovery.");
  } else if (contactOnlyRes.status !== 200) {
    console.error("  ✗ Contact-only recommendations failed:", contactOnlyRes.data);
    process.exit(1);
  } else {
    const candidates = contactOnlyRes.data.data ?? [];
    console.log(`  ✓ ${candidates.length} contact-only candidate(s)`);
    candidates.forEach((c: any) => {
      console.log(`    - ${c.fullName} (${c.relationshipStatus})`);
    });
  }

  console.log("\n=== E2E Verification Complete ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
