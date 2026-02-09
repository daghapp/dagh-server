import { Router } from "express";
import passport from "passport";
import { GoogleAuthController } from "../Modules/authentication/index.js";
import path from "path";

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
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     summary: Google OAuth callback
 *     tags: [OAuth]
 *     responses:
 *       200:
 *         description: Authentication successful
 *       401:
 *         description: Authentication failed
 */
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/auth/google/failed",
    session: false,
  }),
  googleAuthController.googleAuthCallback
);

/**
 * @swagger
 * /auth/google/failed:
 *   get:
 *     summary: Google OAuth failed page
 *     tags: [OAuth]
 *     responses:
 *       401:
 *         description: Authentication failed
 */
router.get("/google/failed", (req, res) => {
  res.status(401).sendFile(path.join(process.cwd(), "src/views/auth-failed.html"));
});

/**
 * @swagger
 * /auth/google/success:
 *   get:
 *     summary: Google OAuth success page
 *     tags: [OAuth]
 *     responses:
 *       200:
 *         description: Authentication successful
 */
router.get("/google/success", (req, res) => {
  res.sendFile(path.join(process.cwd(), "src/views/auth-success.html"));
});

// router.get("/me", protectedRoute, (req, res) => {
//   res.json({ user: req.user });
// });

export { router };
