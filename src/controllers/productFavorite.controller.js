// src/controllers/productFavorite.controller.js
import {
  addProductFavorite,
  removeProductFavorite,
  isProductFavorite,
  getUserFavorites,
} from "../services/productFavorite.service.js";

/**
 * POST /api/v1/products/:productId/favorite
 * Ajouter un produit aux favoris
 */
export async function addFavoriteController(req, res) {
  try {
    const { productId } = req.params;
    const userId = req.user.id;

    const result = await addProductFavorite(userId, productId);

    if (result.alreadyFavorite) {
      return res.status(200).json({
        success: true,
        message: "Product already in favorites",
        isFavorite: true,
      });
    }

    return res.status(201).json({
      success: true,
      isFavorite: true,
    });
  } catch (err) {
    console.error("[PRODUCT_FAVORITES] add error:", err);
    return res.status(500).json({ error: "Could not add to favorites" });
  }
}

/**
 * DELETE /api/v1/products/:productId/favorite
 * Retirer un produit des favoris
 */
export async function removeFavoriteController(req, res) {
  try {
    const { productId } = req.params;
    const userId = req.user.id;

    await removeProductFavorite(userId, productId);

    return res.json({
      success: true,
      isFavorite: false,
    });
  } catch (err) {
    console.error("[PRODUCT_FAVORITES] remove error:", err);
    return res.status(500).json({ error: "Could not remove from favorites" });
  }
}

/**
 * GET /api/v1/products/:productId/favorite
 * Vérifier si un produit est en favoris
 */
export async function checkFavoriteController(req, res) {
  try {
    const { productId } = req.params;
    const userId = req.user.id;

    const result = await isProductFavorite(userId, productId);

    return res.json(result);
  } catch (err) {
    console.error("[PRODUCT_FAVORITES] check error:", err);
    return res.status(500).json({ error: "Could not check favorite status" });
  }
}

/**
 * GET /api/v1/products/favorites
 * Récupérer tous les favoris de l'utilisateur
 */
export async function listFavoritesController(req, res) {
  try {
    const userId = req.user.id;

    const favorites = await getUserFavorites(userId);

    // Retourner directement les produits (filtrer les nulls)
    const products = favorites
      .map((fav) => fav.product)
      .filter((product) => product != null);

    console.log(`[PRODUCT_FAVORITES] list: found ${products.length} favorites for user ${userId}`);
    
    return res.json({ data: products });
  } catch (err) {
    console.error("[PRODUCT_FAVORITES] list error:", err);
    return res.status(500).json({ error: "Could not fetch favorites" });
  }
}
