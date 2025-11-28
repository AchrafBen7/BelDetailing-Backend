// src/routes/stripeConnect.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  createOrGetAccountController,
  createOnboardingLinkController,
  getAccountStatusController,
  getPayoutSummaryController,
} from "../controllers/stripeConnect.controller.js";

const router = Router();

// Créer / récupérer le compte connecté du provider courant
router.post("/connect/account", requireAuth, createOrGetAccountController);

// Obtenir le lien d'onboarding Express
router.post("/connect/onboarding-link", requireAuth, createOnboardingLinkController);

// Voir le status actuel du compte (charges_enabled, payouts_enabled…)
router.get("/connect/account-status", requireAuth, getAccountStatusController);

// 💸 Résumé des payouts & soldes
router.get("/connect/payouts-summary", requireAuth, getPayoutSummaryController);

export default router;
