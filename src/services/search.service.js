// src/services/search.service.js
import { supabase } from "../config/supabase.js";

function mapProviderRow(row) {
  const prices =
    Array.isArray(row.providerServices)
      ? row.providerServices
          .filter(s => s.is_available && s.price > 0)
          .map(s => s.price)
      : [];

  const minPrice = prices.length > 0 ? Math.min(...prices) : null;

  return {
    id: row.user_id,
    displayName: row.display_name,
    companyName: row.company_name ?? "",
    bio: row.bio ?? "",
    city: row.base_city ?? "",
    postalCode: row.postal_code ?? "",
    lat: row.lat ?? 0,
    lng: row.lng ?? 0,
    rating: row.rating ?? 0,
    reviewCount: row.review_count ?? 0,

    // 🔥 LE VRAI PRIX
    minPrice,

    hasMobileService: row.has_mobile_service ?? false,
    logoUrl: row.logo_url ?? null,
    bannerUrl: row.banner_url ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    openingHours: row.opening_hours ?? null,
    serviceCategories: row.services ?? [],
    teamSize: row.team_size ?? 1,
    yearsOfExperience: row.years_of_experience ?? 0,
  };
}

export async function searchProviders(filters) {
  const { q, city } = filters;

  let query = supabase
    .from("provider_profiles")
    .select(`
      *,
      providerServices:services (
        price,
        is_available
      )
    `);

  // 🔍 Search by name
  if (q) {
    query = query.ilike("display_name", `%${q}%`);
  }

  // 🔍 Search by city or postal
  if (city) {
    query = query.or(
      `base_city.ilike.%${city}%,postal_code.ilike.%${city}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error("[SEARCH PROVIDERS] supabase error:", error);
    throw error;
  }

  console.log("🧪 SEARCH PROVIDER:", data[0]);

 return data.map(mapProviderRow);

}



export async function searchOffers(filters) {
  const { q, city, category } = filters;

  let query = supabase.from("offers").select("*").eq("status", "open");

  if (q) query = query.ilike("title", `%${q}%`);

  if (city) query = query.eq("city", city);

  if (category) query = query.eq("category", category);

  const { data, error } = await query;
  if (error) throw error;

  return data;
}
