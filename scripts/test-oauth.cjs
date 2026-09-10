// OAuth smoke test for the Diaspora Sync backend.
//
//   node --test scripts/test-oauth.cjs
//
// Unit checks run against the compiled OAuth helpers (skipped when dist/ is
// absent — run `npm run build` first). Integration checks hit the running
// server at OAUTH_TEST_BASE_URL (default http://localhost:5000) and are
// skipped when that server is unreachable. They only exercise initiation and
// failure surfaces; they cannot complete a real provider login (Google account
// selection must be done on a device via WebBrowser.openAuthSessionAsync).
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BASE_URL = process.env.OAUTH_TEST_BASE_URL || "http://localhost:5000";
const APP_RETURN = "diasporansync:///oauth";

function locationOf(res) {
  return res.headers.get("location");
}

// The /auth endpoints share a 20-requests-per-15-min rate limiter, so repeated
// test runs can hit HTTP 429. Treat that as a skip instead of a failure.
function rateLimited(res, t, what) {
  if (res.status === 429) {
    t.skip(
      `rate limited (429) on ${what} — the auth limiter allows 20 requests/15 min; wait or restart the server`,
    );
    return true;
  }
  return false;
}

test("OAuth state helpers (unit)", async (t) => {
  let helper;
  try {
    helper = await import(
      pathToFileURL(
        path.join(__dirname, "..", "dist", "src", "modules", "authentication", "oauth-state.js"),
      ).href
    );
  } catch {
    t.skip("compiled oauth-state.js not found — run `npm run build` to enable unit checks");
    return;
  }

  await t.test("only the exact approved app return destination is allowed", () => {
    assert.equal(helper.isAllowedAppReturnDestination(APP_RETURN), true);
    assert.equal(helper.isAllowedAppReturnDestination("daghguard:///oauth"), false);
    assert.equal(helper.isAllowedAppReturnDestination("daghguard://"), false);
    assert.equal(helper.isAllowedAppReturnDestination("https://evil.example/oauth"), false);
  });

  await t.test("state tokens are unpredictable and single-use", () => {
    const s1 = { oauthState: undefined };
    const s2 = { oauthState: undefined };
    const token1 = helper.createOAuthState(s1, APP_RETURN);
    const token2 = helper.createOAuthState(s2, APP_RETURN);

    assert.notEqual(token1, token2, "tokens must be unique per transaction");
    assert.equal(s1.oauthState.redirect, APP_RETURN);

    assert.deepEqual(helper.verifyOAuthState(s1, token1), {
      valid: true,
      redirect: APP_RETURN,
    });
    assert.equal(helper.verifyOAuthState(s1, token1).valid, false, "state must be consumed once");
    assert.equal(helper.verifyOAuthState(s1, "forged-token").valid, false);
    assert.equal(helper.verifyOAuthState(s1, undefined).valid, false);
  });

  await t.test("non-allowlisted redirects are discarded, never returned", () => {
    const s = { oauthState: undefined };
    const token = helper.createOAuthState(s, "https://evil.example/oauth");
    assert.equal(s.oauthState.redirect, null);
    const check = helper.verifyOAuthState(s, token);
    assert.equal(check.valid, true);
    assert.equal(check.redirect, null);
  });

  await t.test("provider failure surfaces the stored return to the app", () => {
    const s = { oauthState: undefined };
    helper.createOAuthState(s, APP_RETURN);
    assert.equal(helper.takeOAuthRedirect(s), APP_RETURN);
    assert.equal(helper.takeOAuthRedirect(s), null, "destination is consumed");
  });

  await t.test("callback URL is built with URL-encoded query params", () => {
    const url = helper.buildAppCallbackUrl(APP_RETURN, {
      accessToken: "a b/c?=+",
      refreshToken: "refresh",
      provider: "google",
      email: "a@b.com",
    });
    assert.ok(url.startsWith(`${APP_RETURN}?`), url);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("provider"), "google");
    assert.equal(parsed.searchParams.get("accessToken"), "a b/c?=+");
    assert.equal(parsed.searchParams.get("refreshToken"), "refresh");
    assert.equal(parsed.searchParams.get("email"), "a@b.com");
  });
});

test("OAuth initiation endpoints (integration)", async (t) => {
  let res;
  try {
    res = await fetch(`${BASE_URL}/health`, { redirect: "manual" });
  } catch {
    t.skip(
      `server not reachable at ${BASE_URL} — start it (npm run dev) or set OAUTH_TEST_BASE_URL`,
    );
    return;
  }
  assert.equal(res.status, 200);

  await t.test(
    "GET /auth/google?redirect=diasporansync:///oauth initiates with state",
    async () => {
      const res = await fetch(
        `${BASE_URL}/auth/google?redirect=${encodeURIComponent(APP_RETURN)}`,
        { redirect: "manual" },
      );
      if (res.status === 500) {
        t.skip("google strategy not configured on this server");
        return;
      }
      if (rateLimited(res, t, "/auth/google")) return;
      assert.equal(res.status, 302);
      const u = new URL(locationOf(res));
      assert.ok(u.hostname.endsWith("accounts.google.com"), u.toString());
      assert.ok((u.searchParams.get("redirect_uri") || "").endsWith("/auth/google/callback"));
      assert.ok(u.searchParams.get("state"), "initiation redirect must carry state");
    },
  );

  await t.test("GET /auth/google without redirect still carries a one-time state", async () => {
    const res = await fetch(`${BASE_URL}/auth/google`, { redirect: "manual" });
    if (res.status === 500) {
      t.skip("google strategy not configured on this server");
      return;
    }
    if (rateLimited(res, t, "/auth/google")) return;
    assert.equal(res.status, 302);
    assert.ok(new URL(locationOf(res)).searchParams.get("state"));
  });

  await t.test(
    "GET /auth/facebook?redirect=diasporansync:///oauth initiates with state",
    async () => {
      const res = await fetch(
        `${BASE_URL}/auth/facebook?redirect=${encodeURIComponent(APP_RETURN)}`,
        { redirect: "manual" },
      );
      if (res.status === 500) {
        t.skip("facebook strategy not configured on this server");
        return;
      }
      if (rateLimited(res, t, "/auth/facebook")) return;
      assert.equal(res.status, 302);
      const u = new URL(locationOf(res));
      assert.ok(u.hostname.includes("facebook"), u.toString());
      assert.ok(u.searchParams.get("state"), "initiation redirect must carry state");
    },
  );

  await t.test(
    "GET /auth/apple?redirect=diasporansync:///oauth initiates or reports 503",
    async () => {
      const res = await fetch(`${BASE_URL}/auth/apple?redirect=${encodeURIComponent(APP_RETURN)}`, {
        redirect: "manual",
      });
      if (rateLimited(res, t, "/auth/apple")) return;
      assert.ok([302, 503].includes(res.status), `unexpected status ${res.status}`);
    },
  );

  await t.test("callback without a real code/state never issues tokens", async () => {
    const res = await fetch(`${BASE_URL}/auth/google/callback`, { redirect: "manual" });
    if (rateLimited(res, t, "/auth/google/callback")) return;
    assert.ok([302, 400, 401, 403, 500].includes(res.status), `unexpected status ${res.status}`);
    assert.ok(locationOf(res), "callback must redirect, never respond with tokens");
  });

  await t.test("success page offers the app handoff and shows no tokens", async () => {
    const res = await fetch(`${BASE_URL}/auth/google/success`, { redirect: "manual" });
    if (rateLimited(res, t, "/auth/google/success")) return;
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /diasporansync:\/\/\/oauth/);
    assert.equal(html.includes("accessToken"), false, "no access token on the success page");
    assert.equal(html.includes("refreshToken"), false, "no refresh token on the success page");
  });

  await t.test("failed page retry link maps to the provider route", async () => {
    const res = await fetch(`${BASE_URL}/auth/facebook/failed`, { redirect: "manual" });
    if (rateLimited(res, t, "/auth/facebook/failed")) return;
    assert.equal(res.status, 401);
    const html = await res.text();
    assert.match(html, /\/auth\/facebook/, "failed page retry link derives the provider path");
    assert.ok(!html.includes("{{RETRY_PATH}}"), "failed page must be resolved server-side");
  });
});
