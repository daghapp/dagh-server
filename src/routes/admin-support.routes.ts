import express from "express";
import protectedRoute from "../middleware/protected.js";
import requireAdmin from "../middleware/admin.js";
import { supportController } from "../modules/support/support.controller.js";

const router = express.Router();
router.use(protectedRoute);
router.use(requireAdmin);

router.get("/tickets", supportController.listAllTickets.bind(supportController));
router.get("/tickets/:id", supportController.getTicket.bind(supportController));
router.post("/tickets/:id/reply", supportController.replyTicket.bind(supportController));
router.patch("/tickets/:id/status", supportController.updateStatus.bind(supportController));

export { router };
export default router;
