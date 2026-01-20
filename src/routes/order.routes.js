// src/routes/order.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  listOrders,
  getOrder,
  getOrderByNumber,
  createOrder,
  createOrderPaymentIntent,
  cancelOrder,
  updateOrderTrackingController,
  updateOrderStatusController,
} from "../controllers/order.controller.js";

const router = Router();

router.get("/", requireAuth, listOrders);
router.post("/payment-intent", requireAuth, createOrderPaymentIntent);
router.post("/", requireAuth, createOrder);
router.get("/number/:orderNumber", getOrderByNumber); // Public pour le tracking
router.get("/:id", requireAuth, getOrder);
router.patch("/:id/tracking", requireAuth, updateOrderTrackingController);
router.patch("/:id/status", requireAuth, updateOrderStatusController);
router.delete("/:id/cancel", requireAuth, cancelOrder);

export default router;
