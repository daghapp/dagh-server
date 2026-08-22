import { Request, Response } from "express";
import { generateAccessToken, generateRefreshToken } from "../../helpers/index.js";

const ALLOWED_APP_SCHEMES = ["daghapp://", "daghguard://"];

function isAllowedRedirect(uri: string): boolean {
  return ALLOWED_APP_SCHEMES.some((scheme) => uri.startsWith(scheme));
}

export class AppleAuthController {
  async appleAuthCallback(req: Request, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.redirect("/auth/apple/failed");
      }

      const accessToken = generateAccessToken({
        id: user.id,
        email: user.email,
        accountType: user.accountType,
      });

      const refreshToken = await generateRefreshToken({
        id: user.id,
        email: user.email,
        accountType: user.accountType,
      });

      const rawState = req.body.state as string | undefined;
      const appRedirect = rawState ? Buffer.from(rawState, "base64").toString("utf8") : null;

      // Mobile deep links still pass tokens in URLs (expected for app-to-app redirect)
      if (appRedirect && isAllowedRedirect(appRedirect)) {
        const separator = appRedirect.includes("?") ? "&" : "?";
        return res.redirect(
          `${appRedirect}oauth${separator}accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken!)}&email=${encodeURIComponent(user.email)}`,
        );
      }

      // Web redirects use HTTP-only cookies to prevent token leakage
      res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
      });
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.redirect("/auth/apple/success");
    } catch {
      res.redirect("/auth/apple/failed");
    }
  }
}
