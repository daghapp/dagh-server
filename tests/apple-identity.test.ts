import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma.js";
import { AuthProvider } from "../generated/prisma/client.js";
import {
  AppleEmailRequiredError,
  AppleIdentityConflictError,
  isAppleIdTokenPayloadValid,
  resolveAppleUser,
} from "../src/modules/authentication/apple-identity.js";

const stamp = Date.now();
const email = (label: string) => `apple-identity-${label}-${stamp}@example.test`;

const createdUserIds: string[] = [];

async function makeUser(
  address: string,
  overrides: { appleId?: string; authProvider?: AuthProvider; passwordHash?: string } = {},
) {
  const user = await prisma.user.create({
    data: {
      email: address,
      fullName: "Apple Identity Test",
      authProvider: overrides.authProvider ?? AuthProvider.EMAIL,
      appleId: overrides.appleId,
      passwordHash: overrides.passwordHash,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("resolveAppleUser", () => {
  it("creates an account keyed by Apple's stable sub", async () => {
    const address = email("new");
    const user = await resolveAppleUser({
      appleId: `apple-${stamp}-new`,
      email: address,
      fullName: "New Apple User",
    });

    createdUserIds.push(user.id);
    expect(user.email).toBe(address);
    expect(user.appleId).toBe(`apple-${stamp}-new`);
    expect(user.authProvider).toBe(AuthProvider.ICLOUD);
  });

  it("finds an existing user by appleId even when Apple omits the email", async () => {
    const address = email("no-email");
    const appleId = `apple-${stamp}-no-email`;
    const created = await makeUser(address, { appleId, authProvider: AuthProvider.ICLOUD });

    const user = await resolveAppleUser({ appleId });
    expect(user.id).toBe(created.id);
  });

  it("links appleId to an existing email account on first Apple login", async () => {
    const address = email("link");
    const created = await makeUser(address, { authProvider: AuthProvider.PASSWORD });

    const user = await resolveAppleUser({ appleId: `apple-${stamp}-link`, email: address });
    expect(user.id).toBe(created.id);
    expect(user.appleId).toBe(`apple-${stamp}-link`);
    expect(user.authProvider).toBe(AuthProvider.ICLOUD);
  });

  it("does not let a second Apple identity claim an already-linked email", async () => {
    const address = email("conflict");
    await makeUser(address, { appleId: `apple-${stamp}-owner` });

    await expect(
      resolveAppleUser({ appleId: `apple-${stamp}-intruder`, email: address }),
    ).rejects.toBeInstanceOf(AppleIdentityConflictError);
  });

  it("refuses to create an account when Apple supplies no email", async () => {
    await expect(
      resolveAppleUser({ appleId: `apple-${stamp}-no-email-new` }),
    ).rejects.toBeInstanceOf(AppleEmailRequiredError);
  });
});

describe("isAppleIdTokenPayloadValid", () => {
  const now = Math.floor(Date.now() / 1000);
  const valid = {
    iss: "https://appleid.apple.com",
    aud: "com.example.service.signin",
    exp: now + 300,
  };

  it("accepts a current token from Apple for this client", () => {
    expect(isAppleIdTokenPayloadValid(valid, "com.example.service.signin")).toBe(true);
  });

  it("rejects the wrong issuer, audience, or an expired token", () => {
    expect(isAppleIdTokenPayloadValid({ ...valid, iss: "https://evil.test" }, valid.aud)).toBe(
      false,
    );
    expect(isAppleIdTokenPayloadValid(valid, "com.example.other")).toBe(false);
    expect(isAppleIdTokenPayloadValid({ ...valid, exp: now - 1 }, valid.aud)).toBe(false);
  });
});
