import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";

import {
  listOffers,
  getOffer,
  createOfferController,
  updateOfferController,
  closeOfferController,
  deleteOfferController,
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
router.get("/", listOffers);
router.post("/", requireAuth, createOfferController);

// DETAIL & UPDATE & DELETE & CLOSE
router.get("/:id", getOffer);
router.patch("/:id", requireAuth, updateOfferController);
router.post("/:id/close", requireAuth, closeOfferController);
router.delete("/:id", requireAuth, deleteOfferController);

// FAVORITES - IMPORTANT: Ces routes doivent être définies AVANT les routes paramétrées "/:offerId/applications"
router.post("/:id/favorite", requireAuth, addFavoriteController); // Provider/Company uniquement
router.delete("/:id/favorite", requireAuth, removeFavoriteController); // Provider/Company uniquement
router.get("/:id/favorite", requireAuth, checkFavoriteController); // Provider/Company uniquement

// APPLICATIONS (kandidaturen) liées à une offer
router.get("/:offerId/applications", requireAuth, listApplicationsForOffer);
router.post("/:offerId/apply", requireAuth, applyToOfferController);

export default router;
