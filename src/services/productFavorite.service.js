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
  try {
    console.log(`[PRODUCT_FAVORITES] getUserFavorites: fetching favorites for user ${userId}`);
    
    // D'abord, récupérer les favoris sans la relation
    const { data: favoritesData, error: favoritesError } = await supabase
      .from("product_favorites")
      .select("id, product_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (favoritesError) {
      console.error("[PRODUCT_FAVORITES] getUserFavorites favoritesError:", favoritesError);
      throw favoritesError;
    }

    if (!favoritesData || favoritesData.length === 0) {
      console.log(`[PRODUCT_FAVORITES] getUserFavorites: no favorites found for user ${userId}`);
      return [];
    }

    console.log(`[PRODUCT_FAVORITES] getUserFavorites: found ${favoritesData.length} favorite records`);

    // Récupérer les IDs des produits
    const productIds = favoritesData.map((fav) => fav.product_id);
    
    // Récupérer les produits correspondants
    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select("id, name, description, category, level, price, promo_price, image_url, partner_name, rating, review_count")
      .in("id", productIds);

    if (productsError) {
      console.error("[PRODUCT_FAVORITES] getUserFavorites productsError:", productsError);
      throw productsError;
    }

    // Créer un map pour accéder rapidement aux produits par ID
    const productsMap = new Map();
    if (productsData) {
      productsData.forEach((product) => {
        productsMap.set(product.id, product);
      });
    }

    // Retourner directement les produits (pas besoin de wrapper)
    const products = [];
    
    for (const favoriteItem of favoritesData) {
      const product = productsMap.get(favoriteItem.product_id);
      
      // Ne garder que les favoris avec un produit valide
      if (product != null && product.id != null) {
        products.push(product);
      } else {
        console.warn(`[PRODUCT_FAVORITES] getUserFavorites: skipping favorite ${favoriteItem.id} - product ${favoriteItem.product_id} not found`);
      }
    }

    console.log(`[PRODUCT_FAVORITES] getUserFavorites: returning ${products.length} valid products`);
    return products;
  } catch (err) {
    console.error("[PRODUCT_FAVORITES] getUserFavorites exception:", err);
    throw err;
  }
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
