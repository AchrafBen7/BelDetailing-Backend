// src/routes/missionAgreement.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  getMissionAgreementController,
  listMissionAgreementsController,
  updateMissionAgreementStatusController,
  updateMissionAgreementStripeController,
  updateMissionAgreementDatesController,
  updateMissionAgreementPdfController,
  updateMissionAgreementController,
  confirmMissionAgreementController,
  acceptMissionAgreementController,
  createMissionPaymentsController,
  getPaymentScheduleController,
} from "../controllers/missionAgreement.controller.js";
import {
  getInitialPaymentsController,
  createInitialPaymentsController,
} from "../controllers/missionPaymentInitial.controller.js";
import {
  downloadMissionAgreementPdfController,
  generateMissionAgreementPdfController,
} from "../controllers/missionAgreementPdf.controller.js";

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(requireAuth);

// ⚠️ Routes spécifiques AVANT les routes paramétrées
// GET /api/v1/mission-agreements (doit être avant /:id)
router.get("/", listMissionAgreementsController);

// GET /api/v1/mission-agreements/:id/pdf (télécharger) - AVANT /:id pour éviter les conflits
router.get("/:id/pdf", downloadMissionAgreementPdfController);

// POST /api/v1/mission-agreements/:id/pdf/generate (générer et sauvegarder)
router.post("/:id/pdf/generate", generateMissionAgreementPdfController);

// GET /api/v1/mission-agreements/:id
router.get("/:id", getMissionAgreementController);

// PATCH /api/v1/mission-agreements/:id/status
router.patch("/:id/status", updateMissionAgreementStatusController);

// PATCH /api/v1/mission-agreements/:id/stripe
router.patch("/:id/stripe", updateMissionAgreementStripeController);

// PATCH /api/v1/mission-agreements/:id/dates
router.patch("/:id/dates", updateMissionAgreementDatesController);

// PATCH /api/v1/mission-agreements/:id/pdf
router.patch("/:id/pdf", updateMissionAgreementPdfController);

// PATCH /api/v1/mission-agreements/:id (company édition)
router.patch("/:id", updateMissionAgreementController);

// POST /api/v1/mission-agreements/:id/confirm (company confirmation)
router.post("/:id/confirm", confirmMissionAgreementController);

// POST /api/v1/mission-agreements/:id/accept (detailer acceptance)
router.post("/:id/accept", acceptMissionAgreementController);

// POST /api/v1/mission-agreements/:id/create-payments (company - créer le plan de paiement)
router.post("/:id/create-payments", createMissionPaymentsController);

// GET /api/v1/mission-agreements/:id/payment-schedule (récapitulatif du plan de paiement)
router.get("/:id/payment-schedule", getPaymentScheduleController);

// GET /api/v1/mission-agreements/:id/initial-payments (récupérer les paiements initiaux)
router.get("/:id/initial-payments", getInitialPaymentsController);

// POST /api/v1/mission-agreements/:id/initial-payments/create (créer les paiements initiaux si manquants)
router.post("/:id/initial-payments/create", createInitialPaymentsController);

export default router;
