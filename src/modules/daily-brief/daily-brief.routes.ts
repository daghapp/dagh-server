import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { DailyBriefController } from "./daily-brief.controller.js";

const router = express.Router();
const c = new DailyBriefController();

router.get("/briefs", c.list.bind(c));
router.get("/briefs/latest", c.latest.bind(c));
router.get("/briefs/:date", c.byDate.bind(c));

export { router };
