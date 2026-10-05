import express from "express";
import { AdminDepartmentsController } from "../modules/authentication/admin-departments.controller.js";

const router = express.Router();
const controller = new AdminDepartmentsController();

router.get("/departments", controller.getDepartments.bind(controller));

export { router };
