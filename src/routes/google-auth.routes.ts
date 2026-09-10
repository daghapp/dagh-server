import { readFileSync } from "node:fs";
import { Router } from "express";
import passport from "passport";
import { GoogleAuthController } from "../modules/authentication/index.js";
import {
  createOAuthState,
  isAllowedAppReturnDestination,
} from "../modules/authentication/oauth-state.js";
import { handleOauthFailure } from "../modules/authentication/oauth-handler.js";
import { viewsPath } from "../helpers/view-path.js";

const router = Router();

const googleAuthController = new GoogleAuthController();

/**
 * @swagger
 * /auth/google:
 *   get:
 *     summary: Initiate Google OAuth login
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
 *         description: Redirects to Google OAuth
 */
router.get("/google", (req, res, next) => {
  const redirect = req.query.redirect as string | undefined;
  // Issue an unpredictable, single-use state token bound to the session. Only
  // exact approved app return destinations survive the round-trip.
  const state = createOAuthState(req.session, redirect);
  passport.authenticate("google", {
    scope: ["profile", "email"],
    state,
  })(req, res, next);
});

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     summary: Google OAuth callback endpoint
 *     description: Handles the callback from Google OAuth after user authentication
 *     tags: [OAuth]
 *     parameters:
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         description: Authorization code from Google
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: Opaque one-time state token issued at initiation
 *     responses:
 *       302:
 *         description: Redirects to the app return destination or success/failure page
 */
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/auth/google/failed",
    session: false,
  }),
  googleAuthController.googleAuthCallback,
);

/**
 * @swagger
 * /auth/google/failed:
 *   get:
 *     summary: Google OAuth authentication failed page
 *     description: Displayed when Google OAuth authentication fails
 *     tags: [OAuth]
 *     responses:
 *       302:
 *         description: Returns to the app return destination with an error parameter
 *       401:
 *         description: Authentication failed - renders failure page
 */
router.get("/google/failed", (req, res) => {
  handleOauthFailure(req, res, "auth-failed.html", "/auth/google");
});

/**
 * @swagger
 * /auth/google/success:
 *   get:
 *     summary: Google OAuth authentication success page
 *     description: Displayed when Google OAuth authentication succeeds
 *     tags: [OAuth]
 *     responses:
 *       200:
 *         description: Authentication successful - renders success page
 */
router.get("/google/success", (req, res) => {
  const redirect = req.session?.oauthState?.redirect;
  const template = readFileSync(viewsPath("auth-success.html"), "utf8");
  if (redirect && isAllowedAppReturnDestination(redirect)) {
    const appUrl = `${redirect}?provider=google`;
    res.type("html").send(template.replace("__APP_REDIRECT_URL__", appUrl));
  } else {
    res.type("html").send(template.replace("__APP_REDIRECT_URL__", ""));
  }
});

// router.get("/me", protectedRoute, (req, res) => {
//   res.json({ user: req.user });
// });

export { router };
