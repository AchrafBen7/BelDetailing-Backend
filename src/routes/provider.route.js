import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  listProviders,
  getProvider,
  updateMyProviderProfile,
  createService,
  getProviderServicesController,
  getProviderReviewsController,
  getProviderStatsController,
} from "../controllers/provider.controller.js";
import { createReview } from "../controllers/review.controller.js";

const router = Router();

// ⭐ Services d’un prestataire
router.get("/:id/services", getProviderServicesController);

router.patch("/me", requireAuth, updateMyProviderProfile);

router.post("/services", requireAuth, createService);

// ⭐ Avis d’un prestataire
router.get("/:id/reviews", getProviderReviewsController);

// ⭐ Stats d’un prestataire (dashboard prestataire)
router.get("/:id/stats", requireAuth, getProviderStatsController);

// ⭐ Détail d’un prestataire
router.get("/:id", getProvider);

// ⭐ Liste de tous les prestataires
router.get("/", listProviders);

// ⭐ Création d’un avis
router.post("/reviews", requireAuth, createReview);

export default router;
