// src/routes/product.routes.js
import express from "express";
import {
  listProducts,
  listRecommendedProducts,
  clickProduct,
  getProduct,
} from "../controllers/product.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", listProducts);
router.get("/recommended", listRecommendedProducts);
router.get("/:id", getProduct);
router.post("/:id/click", requireAuth, clickProduct);

export default router;
