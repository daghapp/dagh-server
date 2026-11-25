import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { WebinarsController } from "./webinars.controller.js";
import { requireVerified } from "../../middleware/require-verified.js";

const router = express.Router();
const c = new WebinarsController();

router.get("/webinars", c.list.bind(c));
router.get("/webinars/:id", c.get.bind(c));
router.post("/webinars", protectedRoute, requireVerified("host"), c.create.bind(c));
router.post("/webinars/:id/register", protectedRoute, c.register.bind(c));
router.post("/webinars/:id/paid-register", protectedRoute, c.paidRegister.bind(c));
router.post("/webinars/:id/join", protectedRoute, c.join.bind(c));
router.post("/webinars/:id/recording", protectedRoute, c.uploadRecording.bind(c));
router.get("/webinars/:id/recording", protectedRoute, c.getRecording.bind(c));

export { router };
