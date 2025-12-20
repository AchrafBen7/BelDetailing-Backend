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
  getMyProviderReviews,
} from "../controllers/provider.controller.js";
import { createReview } from "../controllers/review.controller.js";

const router = Router();

// ⭐ Services d’un prestataire

router.get("/me/reviews", requireAuth, getMyProviderReviews);

router.patch("/me", requireAuth, updateMyProviderProfile);
router.get("/:id/services", getProviderServicesController);
router.post("/services", requireAuth, createService);

// ⭐ Avis d’un prestataire
router.get("/:id/reviews", getProviderReviewsController);

// ⭐ Stats d’un prestataire (dashboard prestataire)
router.get("/:id/stats", requireAuth, getProviderStatsController);

// ⭐ Détail d’un prestataire
router.get("/:id", getProvider);

// ⭐ Liste de tous les prestataires
router.get("/", listProviders);


export default router;
