// src/services/provider.service.js
import { supabase } from "../config/supabase.js";

// 🧠 Mapping DB → DTO iOS Detailer
function mapProviderRowToDetailer(row) {
  if (!row) return null;

  return {
    id: row.user_id, // on utilise le user_id comme identifiant public
    displayName: row.display_name,
    companyName: row.company_name ?? null, // optionnel si tu l’ajoutes
    bio: row.bio,
    city: row.base_city,
    postalCode: row.postal_code,
    lat: row.lat ?? 0,
    lng: row.lng ?? 0,
    rating: row.rating ?? 0,
    reviewCount: row.review_count ?? 0,
    minPrice: row.min_price ?? 0,
    hasMobileService: row.has_mobile_service ?? false,
    logoUrl: row.logo_url ?? null,
    bannerUrl: row.banner_url ?? null,
    // On suppose que "services" contient déjà des slugs qui matchent ServiceCategory
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

  if (error) {
    throw error;
  }

  return data.map(mapProviderRowToDetailer);
}

// 🟦 Détail d’un prestataire
export async function getProviderById(providerId) {
  const { data, error } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("user_id", providerId)
    .single();

  if (error) {
    throw error;
  }

  return mapProviderRowToDetailer(data);
}

// 🟦 Services d’un prestataire
export async function getProviderServices(providerId) {
  const { data, error } = await supabase
    .from("services")
    .select("*")
    .eq("provider_id", providerId)
    .order("price", { ascending: true });

  if (error) {
    throw error;
  }

  return data;
}

// 🟦 Avis d’un prestataire
export async function getProviderReviews(providerId) {
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("provider_id", providerId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data;
}

// 🟦 Stats d’un prestataire (pour ton Dashboard iOS)
export async function getProviderStats(providerId) {
  // Plus tard tu feras une vraie query sur bookings
  // Mais pour l'instant renvoie un mock pour éviter les erreurs.

  return {
    monthlyEarnings: 0,
    variationPercent: 0,
    reservationsCount: 0,
    rating: 0,
    clientsCount: 0
  };
}

