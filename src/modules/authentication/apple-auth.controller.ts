import type { Request, Response } from "express";
import { generateAccessToken, generateRefreshToken } from "../../helpers/index.js";
import { resolveChannelAccessForLogin } from "../../services/community.service.js";
import { storeAppleRefreshToken } from "../../services/apple-token.service.js";
import { exchangeAppleAuthorizationCode } from "../../services/apple-oauth.service.js";
import {
  AppleEmailRequiredError,
  AppleIdentityConflictError,
  resolveAppleUser,
} from "./apple-identity.js";
import {
  buildAppCallbackUrl,
  buildAppCallbackUrlWithFragment,
  DEFAULT_APP_RETURN_DESTINATION,
} from "./oauth-state.js";
import { verifyAppleOAuthState } from "./apple-oauth-state.js";

function appleFullName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as { name?: { firstName?: string; lastName?: string } };
    const first = parsed?.name?.firstName ?? "";
    const last = parsed?.name?.lastName ?? "";
    return `${first} ${last}`.trim() || undefined;
  } catch {
    return undefined;
  }
}

function errorCode(error: unknown): string {
  if (error instanceof AppleIdentityConflictError) return "AppleIdentityConflict";
  if (error instanceof AppleEmailRequiredError) return "AppleEmailRequired";
  return "OAuth authorization failed";
}

export class AppleAuthController {
  async appleAuthCallback(req: Request, res: Response): Promise<void> {
    let appRedirect = DEFAULT_APP_RETURN_DESTINATION;

    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const state = verifyAppleOAuthState(typeof body.state === "string" ? body.state : undefined);
      appRedirect = state.appRedirect;

      if (typeof body.error === "string") {
        res.redirect(buildAppCallbackUrl(appRedirect, { error: body.error }));
        return;
      }
      if (typeof body.code !== "string" || !body.code) throw new Error("Missing Apple code");

      const exchange = await exchangeAppleAuthorizationCode(body.code, state.nonceHash);
      const user = await resolveAppleUser({
        appleId: exchange.appleId,
        email: exchange.email,
        fullName: appleFullName(body.user),
      });

      if (exchange.refreshToken) {
        try {
          await storeAppleRefreshToken(user.id, exchange.refreshToken);
        } catch (error) {
          console.error(
            "[apple] failed to store refresh token for revocation:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      const communityAccess = await resolveChannelAccessForLogin(user.id);
      const accessToken = generateAccessToken({
        id: user.id,
        email: user.email,
        accountType: user.accountType,
      });
      const refreshToken = (await generateRefreshToken({
        id: user.id,
        email: user.email,
        accountType: user.accountType,
      }))!;

      res.redirect(
        buildAppCallbackUrlWithFragment(appRedirect, {
          accessToken,
          refreshToken,
          provider: "apple",
          email: user.email,
          accessVersion: String(communityAccess.accessVersion),
          hasChannelAccess: String(communityAccess.hasChannelAccess),
        }),
      );
    } catch (error) {
      console.error("[apple] callback failed:", error instanceof Error ? error.message : error);
      res.redirect(buildAppCallbackUrl(appRedirect, { error: errorCode(error) }));
    }
  }
}
