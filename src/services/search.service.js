// src/services/search.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

const MIN_REVIEWS_TO_DISPLAY_RATING = Number(process.env.MIN_REVIEWS_TO_DISPLAY_RATING) || 5;

function getRatingDisplayForProvider(row) {
  const reviewCount = row.review_count ?? 0;
  const rawRating = row.rating ?? 0;
  if (reviewCount < MIN_REVIEWS_TO_DISPLAY_RATING) {
    return { rating: null, ratingDisplayLabel: "Recommandé par NIOS" };
  }
  return { rating: rawRating, ratingDisplayLabel: null };
}

function getProviderIdentity(row) {
  return row?.id ?? row?.user_id ?? null;
}

function getProviderIdentityKeys(row) {
  const keys = [];
  if (row?.id) keys.push(row.id);
  if (row?.user_id) keys.push(row.user_id);
  return [...new Set(keys.filter(Boolean))];
}

function pickServicesForRow(row, servicesMap) {
  const keys = getProviderIdentityKeys(row);
  for (const key of keys) {
    const services = servicesMap.get(key);
    if (services && services.length) {
      return services;
    }
  }
  return [];
}

function mapProviderRow(row) {
  const prices =
    Array.isArray(row.providerServices)
      ? row.providerServices
          .filter(s => s.is_available && s.price > 0)
          .map(s => s.price)
      : [];

  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const { rating, ratingDisplayLabel } = getRatingDisplayForProvider(row);

  return {
    id: getProviderIdentity(row),
    userId: row.user_id ?? null,
    displayName: row.display_name,
    companyName: row.company_name ?? "",
    bio: row.bio ?? "",
    city: row.base_city ?? "",
    postalCode: row.postal_code ?? "",
    lat: row.lat ?? 0,
    lng: row.lng ?? 0,
    rating,
    ratingDisplayLabel,
    reviewCount: row.review_count ?? 0,

    // 🔥 LE VRAI PRIX
    minPrice,

    hasMobileService: row.has_mobile_service ?? false,
    logoUrl: row.logo_url ?? null,
    bannerUrl: row.banner_url ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    openingHours: row.opening_hours ?? null,

    // ✅ catégories text[]
    serviceCategories: row.services ?? [],

    teamSize: row.team_size ?? 1,
    yearsOfExperience: row.years_of_experience ?? 0,
    serviceArea: row.service_area ?? null, // ✅ Zone d'intervention (JSON)
    welcomingOfferEnabled: row.welcoming_offer_enabled ?? false, // ✅ Offre de bienvenue
    availableToday: row.available_today ?? false, // ✅ Disponible cette semaine
    curatedBadge: row.curated_badge ?? null, // Johari 8.1
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

export async function searchProviders(filters) {
  const { q, city, lat, lng, radius } = filters;

  let query = supabase
    .from("provider_profiles")
    .select("*");

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

  // 🔍 Filtre périmètre (lat, lng, radius en km)
  if (lat != null && lng != null && radius != null) {
    const radiusDeg = Number(radius) / 111;
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

  const { data, error } = await query;

  if (error) {
    console.error("[SEARCH PROVIDERS] supabase error:", error);
    throw error;
  }

  let rows = data ?? [];
  // Filtrage strict par distance si lat/lng/radius fournis
  if (lat != null && lng != null && radius != null) {
    const lat0 = Number(lat);
    const lng0 = Number(lng);
    const rKm = Number(radius);
    rows = rows.filter(row => {
      const pLat = row.lat ?? 0;
      const pLng = row.lng ?? 0;
      const dLatKm = (pLat - lat0) * 111;
      const dLngKm = (pLng - lng0) * 75;
      const approxKm = Math.sqrt(dLatKm * dLatKm + dLngKm * dLngKm);
      return approxKm <= rKm;
    });
  }

  const providerIdSet = new Set();
  rows.forEach(row => {
    getProviderIdentityKeys(row).forEach(idVal => providerIdSet.add(idVal));
  });
  const servicesMap = await fetchProviderServicesMap([...providerIdSet]);
  const withServices = rows.map(row => ({
    ...row,
    providerServices: pickServicesForRow(row, servicesMap),
  }));

  return withServices.map(mapProviderRow);
}



export async function searchOffers(filters) {
  const { q, city, category } = filters;

  let query = supabase.from("offers_with_counts").select("*").eq("status", "open");

  if (q) query = query.ilike("title", `%${q}%`);

  if (city) query = query.eq("city", city);

  if (category) query = query.eq("category", category);

  const { data, error } = await query;
  if (error) throw error;

  return data;
}
