// src/services/offerFavorite.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * Ajouter une offre en favori (provider/company)
 * @param {string} offerId - ID de l'offre
 * @param {string} userId - ID de l'utilisateur (provider ou company)
 */
export async function addOfferFavorite(offerId, userId) {
  try {
    // Vérifier si déjà favori
    const { data: existing, error: checkError } = await supabase
      .from("offer_favorites")
      .select("id")
      .eq("offer_id", offerId)
      .eq("user_id", userId)
      .maybeSingle();

    if (checkError && checkError.code !== "PGRST116") {
      throw checkError;
    }

    // Si déjà favori, retourner success
    if (existing) {
      return { success: true, alreadyFavorite: true };
    }

    // Ajouter en favori
    const { data, error } = await supabase
      .from("offer_favorites")
      .insert({
        offer_id: offerId,
        user_id: userId,
      })
      .select()
      .single();

    if (error) throw error;

    return { success: true, favorite: data };
  } catch (err) {
    console.error("[OFFER_FAVORITE] addOfferFavorite error:", err);
    throw err;
  }
}

/**
 * Retirer une offre des favoris (provider/company)
 * @param {string} offerId - ID de l'offre
 * @param {string} userId - ID de l'utilisateur (provider ou company)
 */
export async function removeOfferFavorite(offerId, userId) {
  try {
    const { error } = await supabase
      .from("offer_favorites")
      .delete()
      .eq("offer_id", offerId)
      .eq("user_id", userId);

    if (error) throw error;

    return { success: true };
  } catch (err) {
    console.error("[OFFER_FAVORITE] removeOfferFavorite error:", err);
    throw err;
  }
}

/**
 * Vérifier si une offre est en favori pour un utilisateur
 * @param {string} offerId - ID de l'offre
 * @param {string} userId - ID de l'utilisateur (provider ou company)
 */
export async function isOfferFavorite(offerId, userId) {
  try {
    const { data, error } = await supabase
      .from("offer_favorites")
      .select("id")
      .eq("offer_id", offerId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    return !!data;
  } catch (err) {
    console.error("[OFFER_FAVORITE] isOfferFavorite error:", err);
    return false;
  }
}

/**
 * 🟦 GET MY OFFER FAVORITES – Récupérer toutes les offres favorites d'un utilisateur
 * @param {string} userId - ID de l'utilisateur (provider ou company)
 * @returns {Promise<Array>} Liste des offres favorites avec leurs détails
 */
export async function getMyOfferFavorites(userId) {
  try {
    // 1) Récupérer les favoris
    const { data: favorites, error: favoritesError } = await supabase
      .from("offer_favorites")
      .select("offer_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (favoritesError) throw favoritesError;

    if (!favorites || favorites.length === 0) {
      return [];
    }

    // 2) Récupérer les détails des offres
    const offerIds = favorites.map(f => f.offer_id);
    
    const { data: offers, error: offersError } = await supabase
      .from("offers_with_counts")
      .select("*")
      .in("id", offerIds);

    if (offersError) throw offersError;

    // 3) Mapper les offres avec la date de favori
    const favoritesMap = new Map(
      favorites.map(f => [f.offer_id, f.created_at])
    );

    return (offers || []).map(offer => ({
      id: offer.id,
      title: offer.title,
      category: offer.category,
      categories: offer.categories || [],
      description: offer.description,
      vehicleCount: offer.vehicle_count,
      priceMin: offer.price_min,
      priceMax: offer.price_max,
      city: offer.city,
      postalCode: offer.postal_code,
      lat: offer.lat,
      lng: offer.lng,
      type: offer.type,
      status: offer.status,
      createdAt: offer.created_at,
      createdBy: offer.created_by,
      companyName: offer.company_name,
      companyLogoUrl: offer.company_logo_url,
      applicationsCount: offer.applications_count,
      favoritedAt: favoritesMap.get(offer.id), // Date d'ajout en favori
    }));
  } catch (err) {
    console.error("[OFFER_FAVORITE] getMyOfferFavorites error:", err);
    throw err;
  }
}
