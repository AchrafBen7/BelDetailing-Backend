// src/routes/productFavorite.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  addFavoriteController,
  removeFavoriteController,
  checkFavoriteController,
  listFavoritesController,
} from "../controllers/productFavorite.controller.js";

const router = Router();

// Routes pour les favoris produits
router.get("/favorites", requireAuth, listFavoritesController);
router.post("/:productId/favorite", requireAuth, addFavoriteController);
router.delete("/:productId/favorite", requireAuth, removeFavoriteController);
router.get("/:productId/favorite", requireAuth, checkFavoriteController);

export default router;
