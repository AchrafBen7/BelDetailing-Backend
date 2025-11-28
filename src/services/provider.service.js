// src/services/provider.service.js
import { supabase } from "../config/supabase.js";

// 🧠 Mapping DB → DTO iOS Detailer
function mapProviderRowToDetailer(row) {
  return {
    id: row.user_id,
    displayName: row.display_name,
    bio: row.bio,
    city: row.base_city ?? "",   // ✔ CORRECT
    postalCode: row.postal_code ?? "",
    lat: row.lat ?? 0,
    lng: row.lng ?? 0,
    rating: row.rating ?? 0,
    reviewCount: row.review_count ?? 0,
    minPrice: row.min_price ?? 0,
    hasMobileService: row.has_mobile_service ?? false,
    logoUrl: row.logo_url ?? null,
    bannerUrl: row.banner_url ?? null,
    serviceCategories: row.services ?? [],
    teamSize: row.team_size ?? 1,
    yearsOfExperience: row.years_of_experience ?? 0,
  };
}


// 🟦 Liste de tous les prestataires
export async function getAllProviders() {
  const { data, error } = await supabase
    .from("provider_profiles")
    .select("*");

  if (error) throw error;
  return data.map(mapProviderRowToDetailer);
}

// 🟦 Services d’un prestataire
export async function getProviderServices(providerId) {
  const { data, error } = await supabase
    .from("services")
    .select("*")
    .eq("provider_id", providerId)
    .order("price", { ascending: true });

  if (error) throw error;
  return data;
}

export async function createProviderService(userId, service) {
  // 1️⃣ Insert dans Supabase
  const { data, error } = await supabase
    .from("services")
    .insert({
      provider_id: userId,
      name: service.name,
      category: service.category,
      price: service.price,
      duration_minutes: service.duration_minutes,
      description: service.description,
      is_available: service.is_available,
      image_url: service.image_url,
      currency: service.currency || "eur",
    })
    .select()
    .single();

  if (error) throw error;

  // 2️⃣ Création auto du produit Stripe (Marketplace)
  try {
    const updatedService = await ensureStripeProductForService(data.id);

    return {
      ...data,
      stripe_product_id: updatedService.productId,
      stripe_price_id: updatedService.priceId,
    };
  } catch (stripeError) {
    console.error("[SERVICE] Stripe product creation failed:", stripeError);

    // ❗ Très important :
    // On ne bloque JAMAIS la création d’un service si Stripe tombe
    return {
      ...data,
      stripe_product_id: null,
      stripe_price_id: null,
      stripeError: true,
    };
  }
}

// 🟦 Détail d’un prestataire
export async function getProviderById(providerId) {
  const { data, error } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("user_id", providerId)
    .single();

  if (error) throw error;
  return mapProviderRowToDetailer(data);
}

// 🟦 Avis d’un prestataire
export async function getProviderReviews(providerId) {
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("provider_id", providerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

// 🟦 Mise à jour du profil provider
export async function updateProviderProfile(userId, updates) {
  const payload = {
    user_id: userId,
    display_name: updates.display_name,
    bio: updates.bio,
    base_city: updates.base_city,   // ✔ FIX
    postal_code: updates.postal_code,
    lat: updates.lat,
    lng: updates.lng,
    has_mobile_service: updates.has_mobile_service,
    min_price: updates.min_price,
    services: updates.services,
    team_size: updates.team_size,
    years_of_experience: updates.years_of_experience,
    logo_url: updates.logo_url,
    banner_url: updates.banner_url
  };

  const { data, error } = await supabase
    .from("provider_profiles")
    .update(payload)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}


// 🟦 Stats mock
export async function getProviderStats() {
  return {
    monthlyEarnings: 0,
    variationPercent: 0,
    reservationsCount: 0,
    rating: 0,
    clientsCount: 0
  };
}
