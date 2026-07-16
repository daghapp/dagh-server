import { Request, Response } from "express";
import { generateAccessToken, generateRefreshToken } from "../../helpers/index.js";

const ALLOWED_APP_SCHEMES = ["daghapp://", "daghguard://"];

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
        accountType: user.accountType,
      });

      const refreshToken = await generateRefreshToken({
        id: user.id,
        email: user.email,
        accountType: user.accountType,
      });

      const rawState = req.query.state as string | undefined;
      const appRedirect = rawState
        ? Buffer.from(rawState, "base64").toString("utf8")
        : null;

      if (appRedirect && isAllowedRedirect(appRedirect)) {
        const separator = appRedirect.includes("?") ? "&" : "?";
        return res.redirect(
          `${appRedirect}oauth${separator}accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken!)}&email=${encodeURIComponent(user.email)}`,
        );
      }

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

      res.redirect("/auth/google/success");
    } catch {
      res.redirect("/auth/google/failed");
    }
  }
}
