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
