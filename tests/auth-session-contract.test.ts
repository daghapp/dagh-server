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

const { PasswordAuthController } =
  await import("../src/modules/authentication/password-auth.controller.js");
const { toAuthUser } = await import("../src/helpers/auth-user.js");

const controller = new PasswordAuthController();

const USER = {
  id: "user-1",
  email: "ama@example.com",
  fullName: "Ama Mensah",
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
    expect(toAuthUser(USER)).toEqual({
      id: "user-1",
      email: "ama@example.com",
      fullName: "Ama Mensah",
      accountType: "USER",
      ethnicity: "African",
    });
  });

  it("preserves a never-chosen ethnicity as null rather than dropping the key", () => {
    // The column is nullable and nothing requires it, so null is a valid state.
    // Omitting the key entirely would read as "field not implemented" and push
    // clients toward re-prompting.
    const payload = toAuthUser({ ...USER, ethnicity: null });

    expect(payload).toHaveProperty("ethnicity", null);
    expect(payload.ethnicity).toBeNull();
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
