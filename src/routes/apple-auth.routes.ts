import { readFileSync } from "node:fs";
import { Router } from "express";
import passport from "passport";
import { AppleAuthController } from "../modules/authentication/apple-auth.controller.js";
import {
  createOAuthState,
  isAllowedAppReturnDestination,
} from "../modules/authentication/oauth-state.js";
import { handleOauthFailure } from "../modules/authentication/oauth-handler.js";
import { viewsPath } from "../helpers/view-path.js";
import { isAppleSignInConfigured } from "../config/apple.js";

const router = Router();

const appleAuthController = new AppleAuthController();

const appleStrategyConfigured = () => isAppleSignInConfigured();

const appleStrategyGuard = (
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) => {
  if (!appleStrategyConfigured()) {
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
 *         description: Exact app return destination (e.g. diasporansync:///oauth)
 *     responses:
 *       302:
 *         description: Redirects to Apple Sign In
 *       503:
 *         description: Apple Sign In is not configured on this server
 */
router.get("/apple", appleStrategyGuard, (req, res, next) => {
  const redirect = req.query.redirect as string | undefined;
  // Issue an unpredictable, single-use state token bound to the session. Only
  // exact approved app return destinations survive the round-trip.
  const state = createOAuthState(req.session, redirect);
  passport.authenticate("apple", {
    scope: ["name", "email"],
    state,
  })(req, res, next);
});

/**
 * @swagger
 * /auth/apple/callback:
 *   post:
 *     summary: Apple Sign In callback endpoint
 *     description: Handles the callback from Apple Sign In after user authentication (POST due to Apple's response_mode=form_post)
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
 *                 description: Authorization code from Apple
 *               id_token:
 *                 type: string
 *                 description: JWT containing user identity info
 *               state:
 *                 type: string
 *                 description: Opaque one-time state token issued at initiation
 *               user:
 *                 type: string
 *                 description: JSON string with user profile (first login only)
 *     responses:
 *       302:
 *         description: Redirects to the app return destination or success/failure page
 */
router.post(
  "/apple/callback",
  appleStrategyGuard,
  passport.authenticate("apple", {
    failureRedirect: "/auth/apple/failed",
    session: false,
  }),
  appleAuthController.appleAuthCallback,
);

/**
 * @swagger
 * /auth/apple/failed:
 *   get:
 *     summary: Apple Sign In authentication failed page
 *     description: Displayed when Apple Sign In authentication fails
 *     tags: [OAuth]
 *     responses:
 *       302:
 *         description: Returns to the app return destination with an error parameter
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
 *     description: Displayed when Apple Sign In authentication succeeds
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
