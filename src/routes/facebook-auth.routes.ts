import { Router } from "express";
import passport from "passport";
import { FacebookAuthController } from "../modules/authentication/facebook-auth.controller.js";
import path from "path";

const router = Router();

const facebookAuthController = new FacebookAuthController();

/**
 * @swagger
 * /auth/facebook:
 *   get:
 *     summary: Initiate Facebook OAuth login
 *     tags: [OAuth]
 *     responses:
 *       302:
 *         description: Redirects to Facebook OAuth
 */
router.get(
  "/facebook",
  passport.authenticate("facebook", { scope: ["email"] })
);


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
 *     responses:
 *       302:
 *         description: Redirects to success or failure page
 */
router.get(
  "/facebook/callback",
  passport.authenticate("facebook", {
    failureRedirect: "/auth/facebook/failed",
    session: false,
  }),
  facebookAuthController.facebookAuthCallback
);

/**
 * @swagger
 * /auth/facebook/failed:
 *   get:
 *     summary: Facebook OAuth authentication failed page
 *     description: Displayed when Facebook OAuth authentication fails
 *     tags: [OAuth]
 *     responses:
 *       401:
 *         description: Authentication failed - renders failure page
 */
router.get("/facebook/failed", (req, res) => {
  res.status(401).sendFile(path.join(process.cwd(), "src/views/auth-failed.html"));
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
  res.sendFile(path.join(process.cwd(), "src/views/auth-success.html"));
});

export { router };
