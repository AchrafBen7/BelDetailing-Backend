// src/routes/sepaDirectDebit.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  createSepaSetupIntentController,
  getSepaMandateController,
  listSepaPaymentMethodsController,
  deleteSepaPaymentMethodController,
  createSepaPaymentIntentController,
  captureSepaPaymentController,
  cancelSepaPaymentController,
} from "../controllers/sepaDirectDebit.controller.js";

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(requireAuth);

// POST /api/v1/sepa/setup-intent
router.post("/setup-intent", createSepaSetupIntentController);

// GET /api/v1/sepa/mandate
router.get("/mandate", getSepaMandateController);

// GET /api/v1/sepa/payment-methods
router.get("/payment-methods", listSepaPaymentMethodsController);

// DELETE /api/v1/sepa/payment-methods/:id
router.delete("/payment-methods/:id", deleteSepaPaymentMethodController);

// POST /api/v1/sepa/payment-intent
router.post("/payment-intent", createSepaPaymentIntentController);

// POST /api/v1/sepa/capture
router.post("/capture", captureSepaPaymentController);

// POST /api/v1/sepa/cancel
router.post("/cancel", cancelSepaPaymentController);

export default router;
