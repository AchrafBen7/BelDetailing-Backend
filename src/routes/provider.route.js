import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";
import {
  listProviders,
  smartBookingProviders,
  getProvider,
  updateMyProviderProfile,
  getAvailableSlotsController,
  getAvailableDaysController,
  createService,
  updateService,
  deleteServiceController,
  getProviderServicesController,
  getProviderReviewsController,
  getProviderStatsController,
  getProviderStatsSeriesController,
  getProviderPopularServicesController,
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
import {
  listBlockedSlotsController,
  createBlockedSlotController,
  deleteBlockedSlotController,
} from "../controllers/blockedSlots.controller.js";

const router = Router();

// ⭐ Blocked slots (provider only)
router.get("/me/blocked-slots", requireAuth, listBlockedSlotsController);
router.post("/me/blocked-slots", requireAuth, createBlockedSlotController);
router.delete("/me/blocked-slots/:id", requireAuth, deleteBlockedSlotController);

// ⭐ Routes spécifiques (doivent être avant les routes paramétrées)
router.get("/me/services", requireAuth, getMyProviderServicesController);
router.get("/me/reviews", requireAuth, getMyProviderReviews);
router.get("/me/stats/series", requireAuth, getProviderStatsSeriesController);
router.get("/me/stats/popular-services", requireAuth, getProviderPopularServicesController);
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
router.patch("/services/:id", requireAuth, updateService); // 🆕 Mise à jour de service
router.delete("/services/:id", requireAuth, deleteServiceController);

// ⭐ Routes paramétrées (/:id/... avant /:id)
router.get("/:id/services", getProviderServicesController);
router.get("/:id/reviews", getProviderReviewsController);
router.get("/:id/stats", requireAuth, getProviderStatsController);
router.get("/:id/available-slots", getAvailableSlotsController);
router.get("/:id/available-days", getAvailableDaysController);
// Détail d'un provider (cache 15 min)
router.get(
  "/:id",
  cacheMiddleware({
    ttl: 900, // 15 minutes
    keyGenerator: (req) => `provider:${req.params.id}`,
  }),
  getProvider
);

// ⭐ Smart Booking : recherche en élargissant le rayon (sans auth, public)
router.get("/smart-booking", smartBookingProviders);

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
