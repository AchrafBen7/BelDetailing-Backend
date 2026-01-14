import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  listProviders,
  getProvider,
  updateMyProviderProfile,
  createService,
  deleteServiceController,
  getProviderServicesController,
  getProviderReviewsController,
  getProviderStatsController,
  getMyProviderReviews,
  getMyProviderServicesController,
  getMyProviderStatsController,
} from "../controllers/provider.controller.js";

const router = Router();

// ⭐ Routes spécifiques (doivent être avant les routes paramétrées)
router.get("/me/services", requireAuth, getMyProviderServicesController);
router.get("/me/reviews", requireAuth, getMyProviderReviews);
router.get("/me/stats", requireAuth, getMyProviderStatsController);
router.patch("/me", requireAuth, updateMyProviderProfile);

// ⭐ Routes services (doivent être avant /:id pour éviter les conflits)
router.post("/services", requireAuth, createService);
router.delete("/services/:id", requireAuth, deleteServiceController);

// ⭐ Routes paramétrées
router.get("/:id/services", getProviderServicesController);
router.get("/:id/reviews", getProviderReviewsController);
router.get("/:id/stats", requireAuth, getProviderStatsController);
router.get("/:id", getProvider);

// ⭐ Liste de tous les prestataires (doit être en dernier)
router.get("/", listProviders);


export default router;
