import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

import {
  listOffers,
  getOffer,
  createOfferController,
  updateOfferController,
  closeOfferController,
  reopenOfferController,
  deleteOfferController,
  listMyOffersController,
} from "../controllers/offer.controller.js";

import {
  listApplicationsForOffer,
  applyToOfferController,
} from "../controllers/application.controller.js";

import {
  addFavoriteController,
  removeFavoriteController,
  checkFavoriteController,
} from "../controllers/offerFavorite.controller.js";

const router = Router();

// LIST & CREATE
// Liste des offres (cache 5 min)
router.get(
  "/",
  cacheMiddleware({
    ttl: 300, // 5 minutes
    keyGenerator: (req) => {
      const params = new URLSearchParams(req.query).toString();
      return `offers:list:${params || "default"}`;
    },
  }),
  listOffers
);
// GET /api/v1/offers/my - Offres créées par l'utilisateur connecté (company)
router.get("/my", requireAuth, listMyOffersController);
router.post("/", requireAuth, createOfferController);

// DETAIL & UPDATE & DELETE & CLOSE
// Détail d'une offre (cache 10 min)
router.get(
  "/:id",
  cacheMiddleware({
    ttl: 600, // 10 minutes
    keyGenerator: (req) => `offer:${req.params.id}`,
  }),
  getOffer
);
router.patch("/:id", requireAuth, updateOfferController);
router.post("/:id/close", requireAuth, closeOfferController);
router.post("/:id/reopen", requireAuth, reopenOfferController);
router.delete("/:id", requireAuth, deleteOfferController);

// FAVORITES - IMPORTANT: Ces routes doivent être définies AVANT les routes paramétrées "/:offerId/applications"
router.post("/:id/favorite", requireAuth, addFavoriteController); // Provider/Company uniquement
router.delete("/:id/favorite", requireAuth, removeFavoriteController); // Provider/Company uniquement
router.get("/:id/favorite", requireAuth, checkFavoriteController); // Provider/Company uniquement

// APPLICATIONS (kandidaturen) liées à une offer
router.get("/:offerId/applications", requireAuth, listApplicationsForOffer);
router.post("/:offerId/apply", requireAuth, applyToOfferController);

export default router;
