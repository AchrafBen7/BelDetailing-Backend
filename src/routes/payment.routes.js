// src/routes/payment.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  createPaymentIntentController,
  capturePaymentController,
  refundPaymentController,
} from "../controllers/payment.controller.js";
import { createStripeProductForServiceController } from "../controllers/stripeProduct.controller.js";

const router = Router();

// Paiements PaymentSheet
router.post("/intent", requireAuth, createPaymentIntentController);
router.post("/capture", requireAuth, capturePaymentController);
router.post("/refund", requireAuth, refundPaymentController);

// Marketplace : créer un produit Stripe pour un service
router.post(
  "/services/:id/stripe-product",
  requireAuth,
  createStripeProductForServiceController
);

export default router;
