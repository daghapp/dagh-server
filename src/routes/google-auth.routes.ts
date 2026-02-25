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


router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/auth/google/failed",
    session: false,
  }),
  googleAuthController.googleAuthCallback
);


router.get("/google/failed", (req, res) => {
  res.status(401).sendFile(path.join(process.cwd(), "src/views/auth-failed.html"));
});


router.get("/google/success", (req, res) => {
  res.sendFile(path.join(process.cwd(), "src/views/auth-success.html"));
});

// router.get("/me", protectedRoute, (req, res) => {
//   res.json({ user: req.user });
// });

export { router };
