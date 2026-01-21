// src/routes/service-category.routes.js
import { Router } from "express";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";
import { listServiceCategories } from "../controllers/service-category.controller.js";

const router = Router();

// GET /api/v1/service-categories (cache 24h - données statiques)
router.get(
  "/",
  cacheMiddleware({ ttl: 86400 }), // 24 heures
  listServiceCategories
);

export default router;
