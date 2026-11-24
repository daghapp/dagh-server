import { readFileSync } from "node:fs";
import { Router, urlencoded } from "express";
import { AppleAuthController } from "../modules/authentication/apple-auth.controller.js";
import { createAppleOAuthState } from "../modules/authentication/apple-oauth-state.js";
import { isAllowedAppReturnDestination } from "../modules/authentication/oauth-state.js";
import { handleOauthFailure } from "../modules/authentication/oauth-handler.js";
import { buildAppleAuthorizeUrl } from "../services/apple-oauth.service.js";
import { viewsPath } from "../helpers/view-path.js";
import { isAppleSignInConfigured } from "../config/apple.js";

const router = Router();

const appleAuthController = new AppleAuthController();

const appleStrategyGuard = (
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) => {
  if (!isAppleSignInConfigured()) {
    return res.status(503).json({
      success: false,
      error: "Apple Sign In is not configured on this server.",
    });
  }
  next();
};

/**
 * @swagger
 * /auth/apple:
 *   get:
 *     summary: Initiate Apple Sign In
 *     tags: [OAuth]
 *     parameters:
 *       - in: query
 *         name: redirect
 *         required: false
 *         schema:
 *           type: string
 *         description: Allowlisted app return destination (defaults to diasporansync:///oauth)
 *     responses:
 *       302:
 *         description: Redirects to Apple Sign In using the backend HTTPS callback
 *       503:
 *         description: Apple Sign In is not configured on this server
 */
router.get("/apple", appleStrategyGuard, (req, res) => {
  try {
    const requested = typeof req.query.redirect === "string" ? req.query.redirect : undefined;
    const { state, nonceHash } = createAppleOAuthState(requested);
    res.redirect(buildAppleAuthorizeUrl(state, nonceHash));
  } catch (error) {
    console.error("[apple] failed to start authorization:", error);
    res.status(500).json({ success: false, error: "Failed to start Apple Sign In" });
  }
});

/**
 * @swagger
 * /auth/apple/callback:
 *   post:
 *     summary: Apple Sign In callback endpoint
 *     description: Handles Apple's form_post with an HTTPS backend callback URL.
 *     tags: [OAuth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *               state:
 *                 type: string
 *               id_token:
 *                 type: string
 *               user:
 *                 type: string
 *               error:
 *                 type: string
 *     responses:
 *       302:
 *         description: Redirects to the app with tokens in the URL fragment or an error
 */
router.post(
  "/apple/callback",
  appleStrategyGuard,
  urlencoded({ extended: false }),
  appleAuthController.appleAuthCallback.bind(appleAuthController),
);

/**
 * @swagger
 * /auth/apple/failed:
 *   get:
 *     summary: Apple Sign In authentication failed page
 *     tags: [OAuth]
 *     responses:
 *       302:
 *         description: Returns to an allowlisted app return destination with an error
 *       401:
 *         description: Authentication failed - renders failure page
 */
router.get("/apple/failed", (req, res) => {
  handleOauthFailure(req, res, "auth-failed.html", "/auth/apple");
});

/**
 * @swagger
 * /auth/apple/success:
 *   get:
 *     summary: Apple Sign In authentication success page
 *     tags: [OAuth]
 *     responses:
 *       200:
 *         description: Authentication successful - renders success page
 */
router.get("/apple/success", (req, res) => {
  const redirect = req.session?.oauthState?.redirect;
  const template = readFileSync(viewsPath("auth-success.html"), "utf8");
  if (redirect && isAllowedAppReturnDestination(redirect)) {
    const appUrl = `${redirect}?provider=apple`;
    res.type("html").send(template.replace("__APP_REDIRECT_URL__", appUrl));
  } else {
    res.type("html").send(template.replace("__APP_REDIRECT_URL__", ""));
  }
});

export { router };
