import { Request, Response } from "express";
import { generateAccessToken, generateRefreshToken } from "../../helpers/index.js";

export class FacebookAuthController {
  async facebookAuthCallback(req: Request, res: Response) {
    try {
      const user = req.user as any;
      if (!user) {
        return res.redirect("/auth/facebook/failed");
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

      // Redirect to success page with tokens in query params
      res.redirect(
        `/auth/facebook/success?email=${encodeURIComponent(user.email)}&accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken!)}`,
      );
    } catch {
      res.redirect("/auth/facebook/failed");
    }
  }
}
