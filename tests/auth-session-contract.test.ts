import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response } from "express";
import type { Ethnicity } from "../generated/prisma/enums.js";

/**
 * Session-response contract for the password auth flows.
 *
 * The bug these guard against: `POST /auth/login` returned the signed-in user
 * (including `ethnicity`) while `POST /auth/refresh-token` returned a bare
 * access token. Both sit on the same user journey — refresh runs whenever the
 * access token expires mid-session — so a client rebuilding its cached session
 * from the refresh response lost every profile field and re-prompted the user
 * for their ethnicity on each resume.
 *
 * The load-bearing assertion is the "same shape" one: it fails if anyone adds a
 * field to one endpoint and forgets the other, which is how the drift happened
 * in the first place.
 */

const prismaMock = {
  user: { findUnique: vi.fn() },
  deviceToken: { findFirst: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  adminActivityLog: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
};

const helpersMock = {
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  generateAccessToken: vi.fn(() => "new-access-token"),
  generateRefreshToken: vi.fn(async () => "new-refresh-token"),
};

vi.mock("../src/config/index.js", () => ({ prisma: prismaMock }));
vi.mock("../src/config/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/helpers/index.js", () => helpersMock);
vi.mock("../src/modules/devices/devices.controller.js", () => ({
  disableAllUserDevices: vi.fn(),
}));
// The controller uses a namespace import (`import * as bcrypt`), so the mock
// must expose the functions at the top level, not only under `default`.
const bcryptMock = { hash: vi.fn(async () => "hashed"), compare: vi.fn(async () => true) };
vi.mock("bcrypt", () => ({ ...bcryptMock, default: bcryptMock }));

const jwtMock = { verify: vi.fn(), sign: vi.fn(() => "signed") };
vi.mock("jsonwebtoken", () => ({ default: jwtMock }));

// Both session endpoints now resolve community access. Mocked rather than
// exercised for real: this file is about the shape of the session response, and a
// live resolver would drag Google, Prisma and the lease clock into it. The two
// resolvers are distinct mocks so the test can assert which strength each
// boundary used — login must force a check and refresh must not.
const resolveForLoginMock = vi.fn();
const resolveForReadMock = vi.fn();
vi.mock("../src/services/community.service.js", () => ({
  resolveChannelAccessForLogin: resolveForLoginMock,
  resolveChannelAccessForRead: resolveForReadMock,
}));

/** A subscribed user with a live lease — the shape every session carries. */
const ACCESS_OPEN = {
  channelId: "UC_target",
  status: "SUBSCRIBED" as const,
  hasChannelAccess: true,
  // ISO strings, not Date: this snapshot crosses the wire, so the fixture is
  // already serialised exactly as a client would see it.
  verifiedAt: "2026-09-30T09:00:00.000Z",
  accessExpiresAt: "2026-09-30T09:01:00.000Z",
  accessVersion: 7,
  requiresGoogleConnection: false,
  reason: null,
};

const { PasswordAuthController } =
  await import("../src/modules/authentication/password-auth.controller.js");
const { toAuthUser } = await import("../src/helpers/auth-user.js");

const controller = new PasswordAuthController();

const USER = {
  id: "user-1",
  email: "ama@example.com",
  fullName: "Ama Mensah",
  firstName: "Ama",
  lastName: "Mensah",
  username: "ama_mensah",
  accountType: "USER",
  accountStatus: "ACTIVE",
  // Widened to the enum so the fixture satisfies AuthUserSource as written.
  ethnicity: "African" as Ethnicity,
  passwordHash: "hashed",
};

function mockRes() {
  const json = vi.fn();
  const status = vi.fn().mockImplementation(() => ({ json }));
  return { res: { status, json } as unknown as Response, json, status };
}

beforeEach(() => {
  vi.clearAllMocks();
  jwtMock.verify.mockReturnValue({ id: "user-1" });
  prismaMock.user.findUnique.mockResolvedValue(USER);
  prismaMock.deviceToken.findFirst.mockResolvedValue({ id: "dt-1", expiredAt: null });
  resolveForLoginMock.mockResolvedValue(ACCESS_OPEN);
  resolveForReadMock.mockResolvedValue({ access: ACCESS_OPEN, checked: false });
  // Both handlers wrap everything in try/catch and turn any throw into a 500, so
  // a broken mock would otherwise surface as a confusing assertion failure about
  // the response contract rather than about the test setup.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

let errorSpy: ReturnType<typeof vi.spyOn>;

afterEach(() => {
  errorSpy.mockRestore();
});

/** Fail loudly if a handler took its catch branch instead of the happy path. */
function expectNoHandlerError() {
  expect(errorSpy).not.toHaveBeenCalled();
}

describe("toAuthUser", () => {
  it("exposes the profile fields a client needs to render a session", () => {
    expect(toAuthUser(USER, ACCESS_OPEN)).toEqual({
      id: "user-1",
      email: "ama@example.com",
      fullName: "Ama Mensah",
      firstName: "Ama",
      lastName: "Mensah",
      username: "ama_mensah",
      accountType: "USER",
      ethnicity: "African",
      communityAccess: ACCESS_OPEN,
    });
  });

  it("preserves a never-chosen ethnicity as null rather than dropping the key", () => {
    // The column is nullable and nothing requires it, so null is a valid state.
    // Omitting the key entirely would read as "field not implemented" and push
    // clients toward re-prompting.
    const payload = toAuthUser({ ...USER, ethnicity: null }, ACCESS_OPEN);

    expect(payload).toHaveProperty("ethnicity", null);
    expect(payload.ethnicity).toBeNull();
  });

  it("carries a locked decision through unchanged", () => {
    // The load-bearing case for the required argument: a signed-out Google user
    // and a signed-in one must both get a complete snapshot, so the client never
    // has to infer "locked" from an absent field.
    const locked = {
      ...ACCESS_OPEN,
      status: "NOT_CONNECTED" as const,
      hasChannelAccess: false,
      accessExpiresAt: null,
      requiresGoogleConnection: true,
      reason: "GOOGLE_NOT_CONNECTED" as const,
    };

    expect(toAuthUser(USER, locked).communityAccess).toEqual(locked);
  });
});

describe("POST /auth/refresh-token", () => {
  async function refresh() {
    const { res, json } = mockRes();
    await controller.newAccessToken({ body: { refreshToken: "rt" } } as Request, res);
    const body = json.mock.calls[0][0];
    expectNoHandlerError();
    return body;
  }

  it("returns the signed-in user, not just a token", async () => {
    const body = await refresh();

    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBe("new-access-token");
    expect(body.data.ethnicity).toBe("African");
    expect(body.data.id).toBe("user-1");
  });

  it("regression: a client rebuilding its session here must still see ethnicity", async () => {
    // The user chose African at signup. After a session resume the client has
    // only this response, so it must not conclude the answer was lost.
    const body = await refresh();

    expect(body.data.ethnicity).toBe("African");
    expect(body.data).not.toHaveProperty("refreshToken");
  });

  it("reuses the already-loaded row rather than issuing a second query", async () => {
    await refresh();

    // The user was loaded for the accountStatus check; returning it is free.
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("returns ethnicity: null for a user who never chose one", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...USER, ethnicity: null });

    const body = await refresh();

    expect(body.data).toHaveProperty("ethnicity", null);
  });

  it("resolves community access so a rebuilt session is not left guessing", async () => {
    // A client rebuilding its session from this response has no other source of
    // truth. Without access here it must either ask again (and risk a second,
    // different answer) or render a locked feed for a paying subscriber.
    const body = await refresh();

    expect(body.data.communityAccess).toEqual(ACCESS_OPEN);
  });

  it("reads access instead of forcing a check, so refresh stays cheap", async () => {
    await refresh();

    // Refresh runs every few minutes on an active session. Forcing a Google call
    // each time would burn quota re-answering a question the lease answers. The
    // read still re-checks a *lapsed* lease, so staleness is not traded away for
    // the saving.
    expect(resolveForReadMock).toHaveBeenCalledWith("user-1");
    expect(resolveForLoginMock).not.toHaveBeenCalled();
  });

  it("still refuses an unknown or expired refresh token before any user read", async () => {
    const { res, status } = mockRes();
    jwtMock.verify.mockImplementation(() => {
      throw new Error("bad signature");
    });

    await controller.newAccessToken({ body: { refreshToken: "nope" } } as Request, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("POST /auth/login", () => {
  it("forces a fresh check, so a lapsed lease cannot unlock a new session", async () => {
    const { res } = mockRes();
    await controller.login(
      { body: { email: USER.email, password: "Password123!" } } as Request,
      res,
    );

    // The load-bearing assertion of the whole feature. A live lease from
    // yesterday's login is exactly what would otherwise let someone who
    // unsubscribed overnight start a new session with an unlocked feed.
    expect(resolveForLoginMock).toHaveBeenCalledWith("user-1");
    expect(resolveForReadMock).not.toHaveBeenCalled();
  });

  it("signs the user in even when access resolution reports a failure", async () => {
    // Best effort by design: a Google outage must lock the feed, not refuse to
    // authenticate. The failure is reported in the snapshot rather than thrown,
    // so a user with no Google connection is a valid signed-in session.
    resolveForLoginMock.mockResolvedValue({
      channelId: "UC_target",
      status: "CHECK_FAILED",
      hasChannelAccess: false,
      verifiedAt: null,
      accessExpiresAt: null,
      accessVersion: 8,
      requiresGoogleConnection: false,
      reason: "VERIFICATION_UNAVAILABLE",
    });
    const { res, json } = mockRes();

    await controller.login(
      { body: { email: USER.email, password: "Password123!" } } as Request,
      res,
    );

    expect(json.mock.calls[0][0].success).toBe(true);
    expect(json.mock.calls[0][0].data.communityAccess.hasChannelAccess).toBe(false);
    expectNoHandlerError();
  });

  it("returns the identical user shape as refresh, plus the refresh token", async () => {
    const { res, json } = mockRes();
    await controller.login(
      { body: { email: USER.email, password: "Password123!" } } as Request,
      res,
    );

    const body = json.mock.calls[0][0];
    expectNoHandlerError();
    expect(body.success).toBe(true);
    expect(body.data.refreshToken).toBe("new-refresh-token");

    const { accessToken, refreshToken, ...loginUser } = body.data;
    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();

    // Same session-resume handler must work for both endpoints.
    const { res: res2, json: json2 } = mockRes();
    await controller.newAccessToken({ body: { refreshToken: "rt" } } as Request, res2);
    const { accessToken: _a, ...refreshUser } = json2.mock.calls[0][0].data;

    expect(loginUser).toEqual(refreshUser);
  });
});
