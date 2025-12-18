// src/routes/product.routes.js
import express from "express";
import {
  listProducts,
  listRecommendedProducts,
  clickProduct,
} from "../controllers/product.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", listProducts);
router.get("/recommended", listRecommendedProducts);
router.post("/:id/click", requireAuth, clickProduct);

export default router;
