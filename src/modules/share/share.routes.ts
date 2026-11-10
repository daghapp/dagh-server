import express from "express";
import { ShareController } from "./share.controller.js";
import protectedRoute from "../../middleware/protected.js";

const router = express.Router();
const controller = new ShareController();

router.get("/app", controller.appPreview.bind(controller));

// Public preview pages (no auth) for crawlers and browsers.
router.get("/:type/:id", controller.preview.bind(controller));

// Authenticated link generation for in-app sharing.
router.post("/links", protectedRoute, controller.createLink.bind(controller));

export { router as ShareRoutes };
export default router;
