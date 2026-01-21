import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";
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
import {
  trackView,
  getViewsStats,
  addFavoriteController,
  removeFavoriteController,
  checkFavoriteController,
  getFavoritesCountController,
  listMyFavoritesController,
} from "../controllers/dopamine.controller.js";
import {
  sendMessage,
  replyMessage,
  listMessages,
  getUnreadCount,
  updateStatus,
} from "../controllers/providerMessage.controller.js";

const router = Router();

// ⭐ Routes spécifiques (doivent être avant les routes paramétrées)
router.get("/me/services", requireAuth, getMyProviderServicesController);
router.get("/me/reviews", requireAuth, getMyProviderReviews);
router.get("/me/stats", requireAuth, getMyProviderStatsController);
router.patch("/me", requireAuth, updateMyProviderProfile);

// ⭐ Routes Dopamine (tracking, favoris, messages)
router.get("/favorites", requireAuth, listMyFavoritesController); // Customer uniquement - Liste des favoris
router.post("/:id/track-view", trackView); // Public (peut être anonyme)
router.get("/:id/views-stats", requireAuth, getViewsStats); // Provider uniquement
router.post("/:id/favorite", requireAuth, addFavoriteController); // Customer uniquement
router.delete("/:id/favorite", requireAuth, removeFavoriteController); // Customer uniquement
router.get("/:id/favorite", requireAuth, checkFavoriteController); // Customer uniquement
router.get("/:id/favorites-count", requireAuth, getFavoritesCountController); // Provider uniquement

// ⭐ Routes Messages (encadrés)
router.post("/:id/message", requireAuth, sendMessage); // Customer uniquement
router.get("/me/messages", requireAuth, listMessages); // Provider uniquement
router.get("/me/messages/unread-count", requireAuth, getUnreadCount); // Provider uniquement
router.post("/messages/:id/reply", requireAuth, replyMessage); // Provider uniquement
router.patch("/messages/:id/status", requireAuth, updateStatus); // Provider uniquement

// ⭐ Routes services (doivent être avant /:id pour éviter les conflits)
router.post("/services", requireAuth, createService);
router.delete("/services/:id", requireAuth, deleteServiceController);

// ⭐ Routes paramétrées
router.get("/:id/services", getProviderServicesController);
router.get("/:id/reviews", getProviderReviewsController);
router.get("/:id/stats", requireAuth, getProviderStatsController);
// Détail d'un provider (cache 15 min)
router.get(
  "/:id",
  cacheMiddleware({
    ttl: 900, // 15 minutes
    keyGenerator: (req) => `provider:${req.params.id}`,
  }),
  getProvider
);

// ⭐ Liste de tous les prestataires (doit être en dernier) - Cache 10 min
router.get(
  "/",
  cacheMiddleware({
    ttl: 600, // 10 minutes
    keyGenerator: (req) => {
      // Inclure les query params dans la clé pour différencier les filtres
      const params = new URLSearchParams(req.query).toString();
      return `providers:list:${params || "default"}`;
    },
  }),
  listProviders
);


export default router;
