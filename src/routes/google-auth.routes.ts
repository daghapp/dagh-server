import { Router } from "express";
import passport from "passport";
import { GoogleAuthController } from "../Modules/authentication/index";
import path from "path";

const router = Router();

const googleAuthController = new GoogleAuthController();
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
  res.status(401).sendFile(path.join(__dirname, "../views/auth-failed.html"));
});

router.get("/google/success", (req, res) => {
  res.sendFile(path.join(__dirname, "../views/auth-success.html"));
});

// router.get("/me", protectedRoute, (req, res) => {
//   res.json({ user: req.user });
// });

export { router };
