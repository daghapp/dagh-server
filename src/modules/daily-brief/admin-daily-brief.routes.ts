import express from "express";
import protectedRoute from "../../middleware/protected.js";
import adminAuth from "../../middleware/admin.js";
import { DailyBriefController } from "./daily-brief.controller.js";

const router = express.Router();
const c = new DailyBriefController();

router.post("/generate", protectedRoute, adminAuth, c.generate.bind(c));

export { router };
