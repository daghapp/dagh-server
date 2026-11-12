import express from "express";
import protectedRoute from "../middleware/protected.js";
import { deepLinksController } from "../modules/deep-links/deep-links.controller.js";

const router = express.Router();

router.post("/links", protectedRoute, deepLinksController.create.bind(deepLinksController));
router.get("/resolve", deepLinksController.resolve.bind(deepLinksController));
router.get("/resolve/:token", deepLinksController.resolve.bind(deepLinksController));
router.post("/resolve", deepLinksController.resolve.bind(deepLinksController));
router.post("/claim", deepLinksController.claim.bind(deepLinksController));
router.get("/go/:type/:id", deepLinksController.redirect.bind(deepLinksController));

export { router };
export default router;

export { router as DeepLinksRoutes };
