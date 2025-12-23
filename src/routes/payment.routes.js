// src/routes/payment.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  createPaymentIntentController,
  capturePaymentController,
  refundPaymentController,
  createSetupIntentController,
  listPaymentMethodsController,
  listTransactionsController,
} from "../controllers/payment.controller.js";
import { createStripeProductForServiceController } from "../controllers/stripeProduct.controller.js";

const router = Router();

// Paiements PaymentSheet
router.post("/intent", requireAuth, createPaymentIntentController);
router.post("/capture", requireAuth, capturePaymentController);
router.post("/refund", requireAuth, refundPaymentController);

// 💳 Cartes (Customer)
router.post("/setup-intent", requireAuth, createSetupIntentController);
router.get("/methods", requireAuth, listPaymentMethodsController);
router.get("/transactions", requireAuth, listTransactionsController);

// Marketplace : créer un produit Stripe pour un service
router.post(
  "/services/:id/stripe-product",
  requireAuth,
  createStripeProductForServiceController
);

export default router;
