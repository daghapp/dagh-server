import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({
  default: { post: vi.fn() },
}));

import axios from "axios";
import { prisma } from "../src/config/prisma.js";
import { AuthProvider } from "../generated/prisma/client.js";
import { decryptSecret, _resetEncryptionKeyCache } from "../src/helpers/encryption.js";
import {
  revokeAppleRefreshToken,
  storeAppleRefreshToken,
} from "../src/services/apple-token.service.js";

const ENCRYPTION_KEY = "7".repeat(64);
const TOKEN_CONTEXT = "apple:refreshToken";
const stamp = Date.now();

let userId: string;
let privateKey: string;

beforeAll(async () => {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const user = await prisma.user.create({
    data: {
      email: `apple-token-${stamp}@example.test`,
      fullName: "Apple Token Test",
      authProvider: AuthProvider.ICLOUD,
      appleId: `apple-token-${stamp}`,
    },
  });
  userId = user.id;
});

beforeEach(() => {
  vi.stubEnv("PAYMENT_GATEWAY_ENCRYPTION_KEY", ENCRYPTION_KEY);
  vi.stubEnv("APPLE_CLIENT_ID", "com.example.service.signin");
  vi.stubEnv("APPLE_TEAM_ID", "TEAMID1234");
  vi.stubEnv("APPLE_KEY_ID", "KEYID12345");
  vi.stubEnv("APPLE_CALLBACK_URL", "https://example.test/auth/apple/callback");
  vi.stubEnv("APPLE_PRIVATE_KEY", privateKey);
  vi.stubEnv("APPLE_PRIVATE_KEY_PATH", "");
  _resetEncryptionKeyCache();
  vi.mocked(axios.post).mockReset();
  vi.mocked(axios.post).mockResolvedValue({ status: 200 } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetEncryptionKeyCache();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("Apple refresh-token retention", () => {
  it("stores the token encrypted, never in plaintext", async () => {
    await storeAppleRefreshToken(userId, "apple-refresh-token");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { appleRefreshToken: true },
    });

    expect(user?.appleRefreshToken).toBeTruthy();
    expect(user?.appleRefreshToken).not.toContain("apple-refresh-token");
    expect(decryptSecret(user!.appleRefreshToken!, TOKEN_CONTEXT)).toBe("apple-refresh-token");
  });

  it("revokes the stored token with a generated Apple client secret", async () => {
    await storeAppleRefreshToken(userId, "token-to-revoke");
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { appleRefreshToken: true },
    });

    await revokeAppleRefreshToken({ id: userId, appleRefreshToken: user!.appleRefreshToken });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = vi.mocked(axios.post).mock.calls[0];
    expect(url).toBe("https://appleid.apple.com/auth/revoke");
    expect(body).toContain("token=token-to-revoke");
    expect(body).toContain("client_id=com.example.service.signin");
    expect(body).toContain("token_type_hint=refresh_token");
  });

  it("no-ops when there is no stored token", async () => {
    await revokeAppleRefreshToken({ id: userId, appleRefreshToken: null });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
