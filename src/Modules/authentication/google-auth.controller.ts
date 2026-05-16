import { Request, Response } from "express";
import { generateAccessToken, generateRefreshToken } from "../../helpers/index.js";

const ALLOWED_APP_SCHEMES = ["daghapp://"];

function isAllowedRedirect(uri: string): boolean {
  return ALLOWED_APP_SCHEMES.some((scheme) => uri.startsWith(scheme));
}

export class GoogleAuthController {
  async googleAuthCallback(req: Request, res: Response) {
    try {
      const user = req.user as any;
      if (!user) {
        return res.redirect("/auth/google/failed");
      }

      const accessToken = generateAccessToken({
        id: user.id,
        email: user.email,
        accountType: user.role,
      });

      const refreshToken = await generateRefreshToken({
        id: user.id,
        email: user.email,
        accountType: user.role,
      });

      // Decode the app redirect URI passed through OAuth state
      const rawState = req.query.state as string | undefined;
      const appRedirect = rawState
        ? Buffer.from(rawState, "base64").toString("utf8")
        : null;

      if (appRedirect && isAllowedRedirect(appRedirect)) {
        const separator = appRedirect.includes("?") ? "&" : "?";
        return res.redirect(
          `${appRedirect}${separator}accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken!)}&email=${encodeURIComponent(user.email)}`,
        );
      }

      // Web fallback
      res.redirect(
        `/auth/google/success?email=${encodeURIComponent(user.email)}&accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken!)}`,
      );
    } catch {
      res.redirect("/auth/google/failed");
    }
  }
}
