import { Request, Response } from "express";
import { finalizeOauthLogin } from "./oauth-handler.js";

export class FacebookAuthController {
  async facebookAuthCallback(req: Request, res: Response) {
    await finalizeOauthLogin(req, res, {
      provider: "facebook",
      failurePath: "/auth/facebook/failed",
      successPath: "/auth/facebook/success",
    });
  }
}
