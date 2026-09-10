import { Router } from "express";
import passport from "passport";
import { FacebookAuthController } from "../modules/authentication/facebook-auth.controller.js";
import { createOAuthState } from "../modules/authentication/oauth-state.js";
import { handleOauthFailure } from "../modules/authentication/oauth-handler.js";
import { viewsPath } from "../helpers/view-path.js";

const router = Router();

const facebookAuthController = new FacebookAuthController();

/**
 * @swagger
 * /auth/facebook:
 *   get:
 *     summary: Initiate Facebook OAuth login
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
 *         description: Redirects to Facebook OAuth
 */
router.get("/facebook", (req, res, next) => {
  const redirect = req.query.redirect as string | undefined;
  // Issue an unpredictable, single-use state token bound to the session. Only
  // exact approved app return destinations survive the round-trip.
  const state = createOAuthState(req.session, redirect);
  passport.authenticate("facebook", { scope: ["email"], state })(req, res, next);
});

/**
 * @swagger
 * /auth/facebook/callback:
 *   get:
 *     summary: Facebook OAuth callback endpoint
 *     description: Handles the callback from Facebook OAuth after user authentication
 *     tags: [OAuth]
 *     parameters:
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         description: Authorization code from Facebook
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
  "/facebook/callback",
  passport.authenticate("facebook", {
    failureRedirect: "/auth/facebook/failed",
    session: false,
  }),
  facebookAuthController.facebookAuthCallback,
);

/**
 * @swagger
 * /auth/facebook/failed:
 *   get:
 *     summary: Facebook OAuth authentication failed page
 *     description: Displayed when Facebook OAuth authentication fails
 *     tags: [OAuth]
 *     responses:
 *       302:
 *         description: Returns to the app return destination with an error parameter
 *       401:
 *         description: Authentication failed - renders failure page
 */
router.get("/facebook/failed", (req, res) => {
  handleOauthFailure(req, res, "auth-failed.html", "/auth/facebook");
});

/**
 * @swagger
 * /auth/facebook/success:
 *   get:
 *     summary: Facebook OAuth authentication success page
 *     description: Displayed when Facebook OAuth authentication succeeds
 *     tags: [OAuth]
 *     responses:
 *       200:
 *         description: Authentication successful - renders success page
 */
router.get("/facebook/success", (req, res) => {
  res.sendFile(viewsPath("auth-success.html"));
});

export { router };
