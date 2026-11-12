import express from "express";
import { ImageProxyController } from "../modules/common/image-proxy.controller.js";

const router = express.Router();
const controller = new ImageProxyController();

router.get("/", controller.proxy.bind(controller));
router.get("/placeholder", controller.placeholder.bind(controller));

export { router };
