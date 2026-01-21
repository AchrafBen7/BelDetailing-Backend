// src/routes/missionPayment.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  createMissionPaymentController,
  getMissionPaymentController,
  listMissionPaymentsController,
  getMissionPaymentSummaryController,
  updateMissionPaymentStatusController,
  getMissionPaymentByStripeController,
  getPendingScheduledPaymentsController,
} from "../controllers/missionPayment.controller.js";

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(requireAuth);

// ⚠️ Routes spécifiques AVANT les routes paramétrées
// GET /api/v1/mission-payments/pending-scheduled (admin only)
router.get("/pending-scheduled", getPendingScheduledPaymentsController);

// GET /api/v1/mission-payments/stripe/:paymentIntentId
router.get("/stripe/:paymentIntentId", getMissionPaymentByStripeController);

// ⚠️ Routes imbriquées pour /mission-agreements/:id/payments (montées sur /mission-agreements)
// GET /api/v1/mission-agreements/:id/payments
router.get("/:id/payments", listMissionPaymentsController);

// GET /api/v1/mission-agreements/:id/payments/summary
router.get("/:id/payments/summary", getMissionPaymentSummaryController);

// GET /api/v1/mission-payments/:id
router.get("/:id", getMissionPaymentController);

// POST /api/v1/mission-payments
router.post("/", createMissionPaymentController);

// PATCH /api/v1/mission-payments/:id/status
router.patch("/:id/status", updateMissionPaymentStatusController);

export default router;
