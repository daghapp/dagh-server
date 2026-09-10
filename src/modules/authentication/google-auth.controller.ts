import { Request, Response } from "express";
import { finalizeOauthLogin } from "./oauth-handler.js";

export class GoogleAuthController {
  async googleAuthCallback(req: Request, res: Response) {
    await finalizeOauthLogin(req, res, {
      provider: "google",
      failurePath: "/auth/google/failed",
      successPath: "/auth/google/success",
    });
  }
}
