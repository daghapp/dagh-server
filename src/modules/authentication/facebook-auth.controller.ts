import { Request, Response } from "express";
import { generateAccessToken, generateRefreshToken } from "../../helpers/index.js";

export class FacebookAuthController {
  async facebookAuthCallback(req: Request, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.redirect("/auth/facebook/failed");
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

      // Phase 1.4 — Store tokens in HTTP-only cookies (not URL query params)
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

      res.redirect("/auth/facebook/success");
    } catch {
      res.redirect("/auth/facebook/failed");
    }
  }
}
