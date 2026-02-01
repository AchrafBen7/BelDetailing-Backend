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
  deletePaymentMethodController,
} from "../controllers/payment.controller.js";
import { createStripeProductForServiceController } from "../controllers/stripeProduct.controller.js";
import { validateRequest } from "../validators/index.js";
import {
  createPaymentIntentValidation,
  capturePaymentValidation,
  refundPaymentValidation,
} from "../validators/payment.validator.js";

const router = Router();

// Paiements PaymentSheet
router.post("/intent", requireAuth, createPaymentIntentValidation, validateRequest, createPaymentIntentController);
router.post("/capture", requireAuth, capturePaymentValidation, validateRequest, capturePaymentController);
router.post("/refund", requireAuth, refundPaymentValidation, validateRequest, refundPaymentController);

// 💳 Cartes (Customer)
router.post("/setup-intent", requireAuth, createSetupIntentController);
router.get("/methods", requireAuth, listPaymentMethodsController);
router.get("/transactions", requireAuth, listTransactionsController);
router.delete(
  "/methods/:paymentMethodId",
  requireAuth,
  deletePaymentMethodController
);

// Marketplace : créer un produit Stripe pour un service
router.post(
  "/services/:id/stripe-product",
  requireAuth,
  createStripeProductForServiceController
);

export default router;
