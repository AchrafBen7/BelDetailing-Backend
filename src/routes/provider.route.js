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
  getMyProviderServicesController,
  getMyProviderStatsController,
} from "../controllers/provider.controller.js";

const router = Router();

// ⭐ Services d’un prestataire
router.get("/me/services", requireAuth, getMyProviderServicesController);
router.get("/:id/services", getProviderServicesController);
router.get("/me/reviews", requireAuth, getMyProviderReviews);

router.patch("/me", requireAuth, updateMyProviderProfile);
router.post("/services", requireAuth, createService);

// ⭐ Avis d’un prestataire
router.get("/:id/reviews", getProviderReviewsController);

// ⭐ Stats d’un prestataire (dashboard prestataire)
router.get("/me/stats", requireAuth, getMyProviderStatsController);
router.get("/:id/stats", requireAuth, getProviderStatsController);

// ⭐ Détail d’un prestataire
router.get("/:id", getProvider);

// ⭐ Liste de tous les prestataires
router.get("/", listProviders);


export default router;
