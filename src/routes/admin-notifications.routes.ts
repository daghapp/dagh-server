import express from "express";
import { AdminNotificationsController } from "../modules/admin/notifications.controller.js";
import protectedRoute from "../middleware/protected.js";
import requireAdmin from "../middleware/admin.js";

const router = express.Router();
const controller = new AdminNotificationsController();

router.get("/", protectedRoute, requireAdmin, controller.list.bind(controller));
router.patch("/:id/read", protectedRoute, requireAdmin, controller.markRead.bind(controller));
router.patch("/read-all", protectedRoute, requireAdmin, controller.markAllRead.bind(controller));
router.delete("/", protectedRoute, requireAdmin, controller.clearAll.bind(controller));

export { router };
