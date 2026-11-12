import express from "express";
import protectedRoute from "../middleware/protected.js";
import { contactsController } from "../modules/contacts/contacts.controller.js";

const router = express.Router();

router.use(protectedRoute);

router.post("/sync", contactsController.sync.bind(contactsController));
router.post("/match", contactsController.match.bind(contactsController));
router.get("/matches", contactsController.getMatches.bind(contactsController));
router.get("/suggestions", contactsController.getMatches.bind(contactsController));
router.delete("/matches", contactsController.clear.bind(contactsController));

export { router };
export default router;

export { router as ContactsRoutes };
