import { Router } from "express";
import passport from "passport";
import { FacebookAuthController } from "../Modules/authentication/facebook-auth.controller.js";
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


router.get(
  "/facebook/callback",
  passport.authenticate("facebook", {
    failureRedirect: "/auth/facebook/failed",
    session: false,
  }),
  facebookAuthController.facebookAuthCallback
);


router.get("/facebook/failed", (req, res) => {
  res.status(401).sendFile(path.join(process.cwd(), "src/views/auth-failed.html"));
});


router.get("/facebook/success", (req, res) => {
  res.sendFile(path.join(process.cwd(), "src/views/auth-success.html"));
});

export { router };
