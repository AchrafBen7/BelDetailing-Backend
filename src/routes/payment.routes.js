// src/routes/payment.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
    createCheckoutSessionController,
  createPaymentIntentController,
  capturePaymentController,
  refundPaymentController,
} from "../controllers/payment.controller.js";
import { createStripeProductForServiceController } from "../controllers/stripeProduct.controller.js";

const router = Router();

// Paiement simple (déjà existant)
router.post("/intent", requireAuth, createPaymentIntentController);
router.post("/capture", requireAuth, capturePaymentController);
router.post("/refund", requireAuth, refundPaymentController);

// 🔥 Marketplace :
router.post(
  "/services/:id/stripe-product",
  requireAuth,
  createStripeProductForServiceController
);

router.post("/checkout", requireAuth, createCheckoutSessionController);

export default router;
