// src/routes/order.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  listOrders,
  getOrder,
  createOrder,
  cancelOrder,
} from "../controllers/order.controller.js";

const router = Router();

router.get("/", requireAuth, listOrders);
router.post("/", requireAuth, createOrder);
router.get("/:id", requireAuth, getOrder);
router.delete("/:id/cancel", requireAuth, cancelOrder);

export default router;
