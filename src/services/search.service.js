// src/services/search.service.js
import { supabase } from "../config/supabase.js";

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

    // ✅ catégories text[]
    serviceCategories: row.services ?? [],

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

export async function searchProviders(filters) {
  const { q, city } = filters;

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

  const { data, error } = await query;

  if (error) {
    console.error("[SEARCH PROVIDERS] supabase error:", error);
    throw error;
  }

  const providerIdSet = new Set();
  if (Array.isArray(data)) {
    data.forEach(row => {
      getProviderIdentityKeys(row).forEach(idVal => providerIdSet.add(idVal));
    });
  }
  const servicesMap = await fetchProviderServicesMap([...providerIdSet]);
  const withServices = data.map(row => ({
    ...row,
    providerServices: pickServicesForRow(row, servicesMap),
  }));

  console.log("🧪 SEARCH PROVIDER:", withServices[0]);

 return withServices.map(mapProviderRow);

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
