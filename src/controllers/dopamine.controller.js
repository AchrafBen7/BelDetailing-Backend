// src/controllers/dopamine.controller.js
import { trackProviderView, getProviderViewsStats } from "../services/dopamine.service.js";
import {
  addFavorite,
  removeFavorite,
  isFavorite,
  getFavoritesCount,
  getCustomerFavoritesWithDetails,
} from "../services/favorite.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * POST /api/v1/providers/:id/track-view
 * Tracker une vue d'un provider profile
 */
export async function trackView(req, res) {
  try {
    const { id: providerId } = req.params;
    const customerId = req.user?.id || null; // Peut être null si anonyme
    const { viewType = "profile" } = req.body; // 'profile' | 'card' | 'map'

    if (!["profile", "card", "map"].includes(viewType)) {
      return res.status(400).json({ error: "Invalid viewType" });
    }

    const success = await trackProviderView(providerId, customerId, viewType);

    if (!success) {
      return res.status(500).json({ error: "Could not track view" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[DOPAMINE] trackView error:", err);
    return res.status(500).json({ error: "Could not track view" });
  }
}

/**
 * GET /api/v1/providers/:id/views-stats
 * Stats de vues pour un provider (provider uniquement)
 */
export async function getViewsStats(req, res) {
  try {
    const { id: providerId } = req.params;
    const userId = req.user.id;

    // Vérifier que c'est le provider qui demande ses stats
    const { data: provider, error } = await supabase
      .from("provider_profiles")
      .select("user_id")
      .or(`id.eq.${providerId},user_id.eq.${providerId}`)
      .maybeSingle();

    if (error || !provider) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const providerUserId = provider.user_id || providerId;

    // Vérifier ownership (provider uniquement)
    if (providerUserId !== userId && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const stats = await getProviderViewsStats(providerUserId);

    return res.json({ data: stats });
  } catch (err) {
    console.error("[DOPAMINE] getViewsStats error:", err);
    return res.status(500).json({ error: "Could not fetch views stats" });
  }
}

/**
 * POST /api/v1/providers/:id/favorite
 * Ajouter un provider en favori (customer uniquement)
 */
export async function addFavoriteController(req, res) {
  try {
    if (req.user.role !== "customer") {
      return res.status(403).json({ error: "Only customers can add favorites" });
    }

    const { id: providerId } = req.params;
    const customerId = req.user.id;

    const result = await addFavorite(providerId, customerId);

    return res.json(result);
  } catch (err) {
    console.error("[FAVORITE] addFavorite error:", err);
    return res.status(500).json({ error: "Could not add favorite" });
  }
}

/**
 * DELETE /api/v1/providers/:id/favorite
 * Retirer un provider des favoris (customer uniquement)
 */
export async function removeFavoriteController(req, res) {
  try {
    if (req.user.role !== "customer") {
      return res.status(403).json({ error: "Only customers can remove favorites" });
    }

    const { id: providerId } = req.params;
    const customerId = req.user.id;

    const result = await removeFavorite(providerId, customerId);

    return res.json(result);
  } catch (err) {
    console.error("[FAVORITE] removeFavorite error:", err);
    return res.status(500).json({ error: "Could not remove favorite" });
  }
}

/**
 * GET /api/v1/providers/:id/favorite
 * Vérifier si un provider est en favori (customer uniquement)
 */
export async function checkFavoriteController(req, res) {
  try {
    if (req.user.role !== "customer") {
      return res.status(403).json({ error: "Only customers can check favorites" });
    }

    const { id: providerId } = req.params;
    const customerId = req.user.id;

    const isFav = await isFavorite(providerId, customerId);

    return res.json({ isFavorite: isFav });
  } catch (err) {
    console.error("[FAVORITE] checkFavorite error:", err);
    return res.status(500).json({ error: "Could not check favorite" });
  }
}

/**
 * GET /api/v1/providers/:id/favorites-count
 * Nombre d'intérêts (favoris) pour un provider (provider uniquement)
 */
export async function getFavoritesCountController(req, res) {
  try {
    const { id: providerId } = req.params;
    const { period = "total" } = req.query; // 'total' | 'this_month' | 'this_week'

    // Vérifier ownership (provider uniquement)
    const { data: provider, error } = await supabase
      .from("provider_profiles")
      .select("user_id")
      .or(`id.eq.${providerId},user_id.eq.${providerId}`)
      .maybeSingle();

    if (error || !provider) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const providerUserId = provider.user_id || providerId;

    if (providerUserId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const count = await getFavoritesCount(providerUserId, period);

    return res.json({ count });
  } catch (err) {
    console.error("[FAVORITE] getFavoritesCount error:", err);
    return res.status(500).json({ error: "Could not fetch favorites count" });
  }
}

/**
 * GET /api/v1/providers/favorites
 * Liste des providers favoris d'un customer avec leurs détails complets
 */
export async function listMyFavoritesController(req, res) {
  try {
    if (req.user.role !== "customer") {
      return res.status(403).json({ error: "Only customers can list favorites" });
    }

    const customerId = req.user.id;
    const favorites = await getCustomerFavoritesWithDetails(customerId);

    if (favorites.length === 0) {
      return res.json({ data: [] });
    }

    // Utiliser getAllProviders et mapProviderRowToDetailer pour mapper correctement
    const { getAllProviders, mapProviderRowToDetailer, fetchProviderServicesMap } = await import("../services/provider.service.js");
    
    // Récupérer les IDs des providers favoris
    const providerIds = favorites.map(f => f.user_id || f.id).filter(Boolean);
    
    // Récupérer les services pour ces providers
    const servicesMap = await fetchProviderServicesMap(providerIds);
    
    // Mapper chaque provider favori
    const favoriteProviders = favorites
      .map(fav => {
        // Ajouter les services au provider
        const providerWithServices = {
          ...fav,
          providerServices: servicesMap.get(fav.user_id) || []
        };
        return mapProviderRowToDetailer(providerWithServices);
      })
      .filter(Boolean);

    return res.json({ data: favoriteProviders });
  } catch (err) {
    console.error("[FAVORITE] listMyFavoritesController error:", err);
    return res.status(500).json({ error: "Could not fetch favorites" });
  }
}
