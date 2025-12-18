// src/services/product.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

function mapProductRowToDto(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    level: row.level,
    price: row.price,
    promoPrice: row.promo_price,
    imageUrl: row.image_url,
    affiliateUrl: row.affiliate_url,
    partnerName: row.partner_name,
    rating: row.rating,
    reviewCount: row.review_count,
  };
}

// 🟦 Liste produits (customer / provider)
export async function getProducts({ category, level, limit } = {}) {
  let query = supabase
    .from("products")
    .select("*")
    .eq("is_active", true);

  if (category) query.eq("category", category);
  if (level) query.eq("level", level);
  if (limit) query.limit(Number(limit));

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;

  return data.map(mapProductRowToDto);
}

// 🟦 Produits recommandés (simple V1)
export async function getRecommendedProducts(limit = 6) {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("rating", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data.map(mapProductRowToDto);
}

// 🟦 Track click (affiliate)
export async function trackProductClick(productId, user) {
  const payload = {
    product_id: productId,
    user_id: user?.id ?? null,
    role: user?.role ?? "anonymous",
  };

  const { error } = await supabase
    .from("product_clicks")
    .insert(payload);

  if (error) {
    console.warn("[PRODUCTS] click tracking failed", error);
  }

  return true;
}
