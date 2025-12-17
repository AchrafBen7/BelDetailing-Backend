// src/services/provider.service.js
import { supabase } from "../config/supabase.js";
import { ensureStripeProductForService } from "./stripeProduct.service.js";

// DB → DTO
function mapProviderRowToDetailer(row) {
  const prices =
    Array.isArray(row.providerServices)
      ? row.providerServices
          .filter(s => s.is_available && s.price > 0)
          .map(s => s.price)
      : [];

  const computedMinPrice =
    prices.length > 0 ? Math.min(...prices) : null;

  return {
    id: row.id,
    userId: row.user_id ?? null,
    displayName: row.display_name,
    bio: row.bio,
    city: row.base_city ?? "",
    postalCode: row.postal_code ?? "",
    lat: row.lat ?? 0,
    lng: row.lng ?? 0,
    rating: row.rating ?? 0,
    reviewCount: row.review_count ?? 0,

    // 🔥 ICI LA VÉRITÉ
    minPrice: computedMinPrice,

    hasMobileService: row.has_mobile_service ?? false,
    logoUrl: row.logo_url ?? null,
    bannerUrl: row.banner_url ?? null,
    serviceCategories: row.services ?? [],
    phone: row.phone ?? null,
    email: row.email ?? null,
    openingHours: row.opening_hours ?? null,
    teamSize: row.team_size ?? 1,
    yearsOfExperience: row.years_of_experience ?? 0,
  };
}

async function fetchProviderServicesMap(providerIds) {
  if (!Array.isArray(providerIds) || providerIds.length === 0) {
    return new Map();
  }

  const uniqueIds = [...new Set(providerIds)];
  const { data, error } = await supabase
    .from("services")
    .select("provider_id, price, is_available")
    .in("provider_id", uniqueIds);

  if (error) throw error;

  const map = new Map();
  (data ?? []).forEach(service => {
    const list = map.get(service.provider_id) ?? [];
    list.push({
      price: service.price,
      is_available: service.is_available,
    });
    map.set(service.provider_id, list);
  });

  return map;
}

// 🟦 Liste de tous les prestataires (+ optionele filters)
export async function getAllProviders(options = {}) {
const { sort, limit, lat, lng, radius, requestedSort } = options;

const sortForDb =
  sort === "rating,-priceMin"
    ? "rating"
    : sort;

let query = supabase
  .from("provider_profiles")
  .select("*");


// 1) Filtre "nearby" (bounding box) si lat/lng/radius fournis
if (lat != null && lng != null && radius != null) {
const radiusDeg = Number(radius) / 111; // 1° ≈ 111 km

const minLat = Number(lat) - radiusDeg;

const maxLat = Number(lat) + radiusDeg;

const minLng = Number(lng) - radiusDeg;

const maxLng = Number(lng) + radiusDeg;

query = query

  .gte("lat", minLat)

  .lte("lat", maxLat)

  .gte("lng", minLng)

  .lte("lng", maxLng);

}

// 2) Tri optionnel (recommandations)
if (sortForDb === "rating") {
  query = query.order("rating", { ascending: false });
}

if (limit) {
query = query.limit(Number(limit));

}

const { data, error } = await query;
if (error) throw error;

const providerIds = Array.isArray(data)
  ? data.map(row => row.id).filter(Boolean)
  : [];
const servicesMap = await fetchProviderServicesMap(providerIds);

const mapped = data.map(row =>
  mapProviderRowToDetailer({
    ...row,
    providerServices: servicesMap.get(row.id) ?? [],
  })
);

const effectiveSort = requestedSort ?? sort;
if (effectiveSort === "rating,-priceMin") {
  mapped.sort((a, b) => {
    if (a.rating !== b.rating) {
      return b.rating - a.rating;
    }
    if (a.minPrice == null) return 1;
    if (b.minPrice == null) return -1;
    return a.minPrice - b.minPrice;
  });
}

// 3) Tri par distance approximative côté Node si lat/lng/radius fournis
if (lat != null && lng != null && radius != null) {
const lat0 = Number(lat);

const lng0 = Number(lng);

const rKm = Number(radius);


// approx: 1° lat = 111 km, 1° lon ≈ 75 km en Belgique

const withDistance = mapped.map(p => {

  const dLatKm = (p.lat - lat0) * 111;

  const dLngKm = (p.lng - lng0) * 75;

  const approxKm = Math.sqrt(dLatKm * dLatKm + dLngKm * dLngKm);

  return { ...p, approxDistanceKm: approxKm };

});


// Filtrer strictement <= radius

const filtered = withDistance.filter(p => p.approxDistanceKm <= rKm);


// Trier par distance croissante

filtered.sort((a, b) => a.approxDistanceKm - b.approxDistanceKm);


// Nettoyer la clé temporaire

return filtered.map(({ approxDistanceKm, ...rest }) => rest);

}

return mapped;
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
  const { data: provider, error: providerLookupError } = await supabase
    .from("provider_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (providerLookupError) throw providerLookupError;
  if (!provider?.id) {
    const err = new Error("Provider profile not found");
    err.statusCode = 404;
    throw err;
  }

  // 1️⃣ Insert dans Supabase
  const { data, error } = await supabase
    .from("services")
    .insert({
      provider_id: provider.id,
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
    .eq("id", providerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const servicesMap = await fetchProviderServicesMap([providerId]);
  return mapProviderRowToDetailer({
    ...data,
    providerServices: servicesMap.get(providerId) ?? [],
  });
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
    banner_url: updates.banner_url,
    phone: updates.phone,
  email: updates.email,
  opening_hours: updates.opening_hours
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
