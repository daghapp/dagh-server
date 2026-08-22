import { Router } from "express";
import passport from "passport";
import { GoogleAuthController } from "../modules/authentication/index.js";
import { viewsPath } from "../helpers/view-path.js";

const router = Router();

const googleAuthController = new GoogleAuthController();

/**
 * @swagger
 * /auth/google:
 *   get:
 *     summary: Initiate Google OAuth login
 *     tags: [OAuth]
 *     responses:
 *       302:
 *         description: Redirects to Google OAuth
 */
router.get("/google", (req, res, next) => {
  const redirect = req.query.redirect as string | undefined;
  passport.authenticate("google", {
    scope: ["profile", "email"],
    // encode the app redirect URI into state so it survives the OAuth round-trip
    state: redirect ? Buffer.from(redirect).toString("base64") : undefined,
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
 *         description: Base64-encoded redirect URI
 *     responses:
 *       302:
 *         description: Redirects to success or failure page
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
 *       401:
 *         description: Authentication failed - renders failure page
 */
router.get("/google/failed", (_req, res) => {
  res.status(401).sendFile(viewsPath("auth-failed.html"));
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
router.get("/google/success", (_req, res) => {
  res.sendFile(viewsPath("auth-success.html"));
});

// router.get("/me", protectedRoute, (req, res) => {
//   res.json({ user: req.user });
// });

export { router };
