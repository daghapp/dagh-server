import { Request, Response } from "express";
import { finalizeOauthLogin } from "./oauth-handler.js";

export class AppleAuthController {
  async appleAuthCallback(req: Request, res: Response) {
    await finalizeOauthLogin(req, res, {
      provider: "apple",
      failurePath: "/auth/apple/failed",
      successPath: "/auth/apple/success",
    });
  }
}
