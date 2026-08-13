import { Router } from "express";
import passport from "passport";
import { AppleAuthController } from "../modules/authentication/apple-auth.controller.js";
import { viewsPath } from "../helpers/view-path.js";

const router = Router();

const appleAuthController = new AppleAuthController();

const appleStrategyConfigured = () =>
  Boolean(
    process.env.APPLE_CLIENT_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY_PATH &&
    process.env.APPLE_CALLBACK_URL,
  );

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
 *     responses:
 *       302:
 *         description: Redirects to Apple Sign In
 */
router.get("/apple", appleStrategyGuard, (req, res, next) => {
  const redirect = req.query.redirect as string | undefined;
  passport.authenticate("apple", {
    scope: ["name", "email"],
    state: redirect ? Buffer.from(redirect).toString("base64") : undefined,
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
 *                 description: Base64-encoded redirect URI
 *               user:
 *                 type: string
 *                 description: JSON string with user profile (first login only)
 *     responses:
 *       302:
 *         description: Redirects to success or failure page
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
 *       401:
 *         description: Authentication failed - renders failure page
 */
router.get("/apple/failed", (_req, res) => {
  res.status(401).sendFile(viewsPath("auth-failed.html"));
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
router.get("/apple/success", (_req, res) => {
  res.sendFile(viewsPath("auth-success.html"));
});

export { router };
