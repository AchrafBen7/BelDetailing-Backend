// src/services/favorite.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * Ajouter un provider en favori (customer)
 * @param {string} providerId - ID du provider (user_id)
 * @param {string} customerId - ID du customer
 */
export async function addFavorite(providerId, customerId) {
  try {
    // Vérifier si déjà favori
    const { data: existing, error: checkError } = await supabase
      .from("provider_favorites")
      .select("id")
      .eq("provider_id", providerId)
      .eq("customer_id", customerId)
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
      .from("provider_favorites")
      .insert({
        provider_id: providerId,
        customer_id: customerId,
      })
      .select()
      .single();

    if (error) throw error;

    return { success: true, favorite: data };
  } catch (err) {
    console.error("[FAVORITE] addFavorite error:", err);
    throw err;
  }
}

/**
 * Retirer un provider des favoris (customer)
 * @param {string} providerId - ID du provider (user_id)
 * @param {string} customerId - ID du customer
 */
export async function removeFavorite(providerId, customerId) {
  try {
    const { error } = await supabase
      .from("provider_favorites")
      .delete()
      .eq("provider_id", providerId)
      .eq("customer_id", customerId);

    if (error) throw error;

    return { success: true };
  } catch (err) {
    console.error("[FAVORITE] removeFavorite error:", err);
    throw err;
  }
}

/**
 * Vérifier si un provider est en favori pour un customer
 * @param {string} providerId - ID du provider (user_id)
 * @param {string} customerId - ID du customer
 */
export async function isFavorite(providerId, customerId) {
  try {
    const { data, error } = await supabase
      .from("provider_favorites")
      .select("id")
      .eq("provider_id", providerId)
      .eq("customer_id", customerId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    return !!data;
  } catch (err) {
    console.error("[FAVORITE] isFavorite error:", err);
    return false;
  }
}

/**
 * Compter le nombre d'intérêts (favoris) pour un provider
 * @param {string} providerId - ID du provider (user_id)
 * @param {string} period - 'total' | 'this_month' | 'this_week'
 */
export async function getFavoritesCount(providerId, period = "total") {
  try {
    let query = supabase
      .from("provider_favorites")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", providerId);

    // Filtrer par période
    if (period === "this_month") {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      query = query.gte("created_at", startOfMonth.toISOString());
    } else if (period === "this_week") {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      query = query.gte("created_at", startOfWeek.toISOString());
    }

    const { count, error } = await query;

    if (error) throw error;

    return count || 0;
  } catch (err) {
    console.error("[FAVORITE] getFavoritesCount error:", err);
    throw err;
  }
}

/**
 * Liste des favoris d'un customer (IDs seulement)
 * @param {string} customerId - ID du customer
 */
export async function getCustomerFavorites(customerId) {
  try {
    const { data, error } = await supabase
      .from("provider_favorites")
      .select("provider_id, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (err) {
    console.error("[FAVORITE] getCustomerFavorites error:", err);
    throw err;
  }
}

/**
 * Liste des providers favoris d'un customer avec leurs détails complets
 * @param {string} customerId - ID du customer
 */
export async function getCustomerFavoritesWithDetails(customerId) {
  try {
    // 1. Récupérer les IDs des providers favoris
    const favorites = await getCustomerFavorites(customerId);
    
    if (favorites.length === 0) {
      return [];
    }
    
    const providerIds = favorites.map(f => f.provider_id);
    
    // 2. Récupérer les profils complets des providers
    const { data: profiles, error } = await supabase
      .from("provider_profiles")
      .select("*")
      .in("user_id", providerIds);
    
    if (error) throw error;
    
    // 3. Mapper les résultats avec l'ordre des favoris
    const favoritesMap = new Map(
      favorites.map(f => [f.provider_id, f.created_at])
    );
    
    return (profiles || [])
      .map(profile => ({
        ...profile,
        favoritedAt: favoritesMap.get(profile.user_id)
      }))
      .sort((a, b) => {
        const dateA = new Date(a.favoritedAt || 0);
        const dateB = new Date(b.favoritedAt || 0);
        return dateB - dateA; // Plus récent en premier
      });
  } catch (err) {
    console.error("[FAVORITE] getCustomerFavoritesWithDetails error:", err);
    throw err;
  }
}
