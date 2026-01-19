// src/services/productFavorite.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * Ajouter un produit aux favoris
 */
export async function addProductFavorite(userId, productId) {
  const { data, error } = await supabase
    .from("product_favorites")
    .insert({
      user_id: userId,
      product_id: productId,
    })
    .select()
    .single();

  if (error) {
    // Si l'erreur est "duplicate key", le produit est déjà en favoris
    if (error.code === "23505") {
      return { alreadyFavorite: true };
    }
    throw error;
  }

  return { favorite: data };
}

/**
 * Retirer un produit des favoris
 */
export async function removeProductFavorite(userId, productId) {
  const { error } = await supabase
    .from("product_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("product_id", productId);

  if (error) throw error;
  return { success: true };
}

/**
 * Vérifier si un produit est en favoris
 */
export async function isProductFavorite(userId, productId) {
  const { data, error } = await supabase
    .from("product_favorites")
    .select("id")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();

  if (error) throw error;
  return { isFavorite: !!data };
}

/**
 * Récupérer tous les favoris d'un utilisateur avec les détails des produits
 */
export async function getUserFavorites(userId) {
  const { data, error } = await supabase
    .from("product_favorites")
    .select(`
      id,
      product_id,
      created_at,
      products (
        id,
        name,
        description,
        category,
        level,
        price,
        promo_price,
        image_url,
        affiliate_url,
        partner_name,
        rating,
        review_count
      )
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // Transformer les données pour retourner directement les produits
  return data
    .filter((item) => item.products) // Filtrer les produits qui n'existent plus
    .map((item) => ({
      id: item.id,
      productId: item.product_id,
      createdAt: item.created_at,
      product: item.products,
    }));
}

/**
 * Récupérer les IDs des produits favoris d'un utilisateur
 */
export async function getUserFavoriteProductIds(userId) {
  const { data, error } = await supabase
    .from("product_favorites")
    .select("product_id")
    .eq("user_id", userId);

  if (error) throw error;
  return data.map((item) => item.product_id);
}
