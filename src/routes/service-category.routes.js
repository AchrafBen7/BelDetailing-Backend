// src/routes/service-category.routes.js
import { Router } from "express";
import { listServiceCategories } from "../controllers/service-category.controller.js";

const router = Router();

// GET /api/v1/service-categories
router.get("/", listServiceCategories);

export default router;
