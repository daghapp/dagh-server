import express from "express";
import protectedRoute from "../middleware/protected.js";
import { supportController } from "../modules/support/support.controller.js";

const router = express.Router();
router.use(protectedRoute);

router.post("/tickets", supportController.createTicket.bind(supportController));
router.get("/tickets", supportController.listMyTickets.bind(supportController));
router.get("/tickets/:id", supportController.getTicket.bind(supportController));

export { router };
export default router;
