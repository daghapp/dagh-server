import express from "express";
import protectedRoute from "../../middleware/protected.js";
import { ListingsController } from "./listings.controller.js";
import { requireVerified } from "../../middleware/require-verified.js";

const router = express.Router();
const c = new ListingsController();

router.get("/listings", c.list.bind(c));
router.get("/listings/:id", c.get.bind(c));
router.post("/listings", protectedRoute, requireVerified("list"), c.create.bind(c));
router.post("/listings/:id/submit", protectedRoute, requireVerified("list"), c.submit.bind(c));
router.post("/listings/search-requests", protectedRoute, c.createSearchRequest.bind(c));

export { router };
