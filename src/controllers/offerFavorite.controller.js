// src/controllers/offerFavorite.controller.js
import {
  addOfferFavorite,
  removeOfferFavorite,
  isOfferFavorite,
} from "../services/offerFavorite.service.js";

/**
 * POST /api/v1/offers/:id/favorite
 * Ajouter une offre aux favoris (provider/company)
 */
export async function addFavoriteController(req, res) {
  try {
    const { id: offerId } = req.params;
    const userId = req.user.id;

    // Seuls les providers et companies peuvent sauvegarder des offres
    if (req.user.role !== "provider" && req.user.role !== "company") {
      return res.status(403).json({ error: "Only providers and companies can save offers" });
    }

    const result = await addOfferFavorite(offerId, userId);
    return res.json(result);
  } catch (err) {
    console.error("[OFFER_FAVORITE] addFavoriteController error:", err);
    return res.status(500).json({ error: "Could not add offer to favorites" });
  }
}

/**
 * DELETE /api/v1/offers/:id/favorite
 * Retirer une offre des favoris (provider/company)
 */
export async function removeFavoriteController(req, res) {
  try {
    const { id: offerId } = req.params;
    const userId = req.user.id;

    // Seuls les providers et companies peuvent retirer des offres
    if (req.user.role !== "provider" && req.user.role !== "company") {
      return res.status(403).json({ error: "Only providers and companies can unsave offers" });
    }

    await removeOfferFavorite(offerId, userId);
    return res.json({ success: true });
  } catch (err) {
    console.error("[OFFER_FAVORITE] removeFavoriteController error:", err);
    return res.status(500).json({ error: "Could not remove offer from favorites" });
  }
}

/**
 * GET /api/v1/offers/:id/favorite
 * Vérifier si une offre est en favori pour l'utilisateur connecté
 */
export async function checkFavoriteController(req, res) {
  try {
    const { id: offerId } = req.params;
    const userId = req.user.id;

    // Seuls les providers et companies peuvent vérifier les favoris
    if (req.user.role !== "provider" && req.user.role !== "company") {
      return res.status(403).json({ error: "Only providers and companies can check offer favorites" });
    }

    const isFavorite = await isOfferFavorite(offerId, userId);
    return res.json({ isFavorite });
  } catch (err) {
    console.error("[OFFER_FAVORITE] checkFavoriteController error:", err);
    return res.status(500).json({ error: "Could not check offer favorite status" });
  }
}
