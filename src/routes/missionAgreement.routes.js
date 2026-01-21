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
} from "../controllers/missionAgreement.controller.js";
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

export default router;
