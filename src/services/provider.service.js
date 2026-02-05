// src/services/provider.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { ensureStripeProductForService } from "./stripeProduct.service.js";
import { getProviderIdsWithAvailabilityThisWeek } from "./providerAvailability.service.js";

// Johari 9.4 : en dessous de ce seuil, on ne renvoie pas la note chiffrée (rating: null) et on affiche un label curé
const MIN_REVIEWS_TO_DISPLAY_RATING = Number(process.env.MIN_REVIEWS_TO_DISPLAY_RATING) || 5;

function getRatingDisplayForProvider(row) {
  const reviewCount = row.review_count ?? 0;
  const rawRating = row.rating ?? 0;
  if (reviewCount < MIN_REVIEWS_TO_DISPLAY_RATING) {
    return { rating: null, ratingDisplayLabel: "Recommandé par NIOS" };
  }
  return { rating: rawRating, ratingDisplayLabel: null };
}

let providerProfilesSupportsIdColumn;

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

async function fetchProviderProfileByAnyId(identifier) {
  if (identifier == null) return null;

  if (providerProfilesSupportsIdColumn !== false) {
    const { data, error } = await supabase
      .from("provider_profiles")
      .select("*")
      .eq("id", identifier)
      .maybeSingle();

    if (error) {
      if (error.code === "42703") {
        providerProfilesSupportsIdColumn = false;
      } else {
        throw error;
      }
    } else if (data) {
      providerProfilesSupportsIdColumn = true;
      return data;
    }
  }

  const { data, error } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("user_id", identifier)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// DB → DTO
export function mapProviderRowToDetailer(row) {
  const prices =
    Array.isArray(row.providerServices)
      ? row.providerServices
          .filter(s => s.is_available && s.price > 0)
          .map(s => s.price)
      : [];

  const computedMinPrice =
    prices.length > 0 ? Math.min(...prices) : null;

  const { rating, ratingDisplayLabel } = getRatingDisplayForProvider(row);

  return {
    id: getProviderIdentity(row), // provider_profiles.id (fallback user_id)
    userId: row.user_id ?? null, // auth.users.id
    displayName: row.display_name,
    companyName: row.company_name ?? null, // ✅ Ajouté pour correspondre au modèle iOS
    bio: row.bio,
    city: row.base_city ?? "",
    postalCode: row.postal_code ?? "",
    lat: row.lat ?? 0,
    lng: row.lng ?? 0,
    rating,
    ratingDisplayLabel,
    reviewCount: row.review_count ?? 0,

    // 🔥 ICI LA VÉRITÉ
    minPrice: computedMinPrice,

    hasMobileService: row.has_mobile_service ?? false,
    hasGarage: row.has_garage ?? false,
    logoUrl: row.logo_url ?? null,
    bannerUrl: row.banner_url ?? null,
    serviceCategories: row.services ?? [],
    phone: row.phone ?? null,
    email: row.email ?? null,
    openingHours: row.opening_hours ?? null,
    teamSize: row.team_size ?? 1,
    yearsOfExperience: row.years_of_experience ?? 0,
    maxRadiusKm: row.max_radius_km ?? null,
    serviceArea: row.service_area ?? null, // ✅ Zone d'intervention (JSON)
    welcomingOfferEnabled: row.welcoming_offer_enabled ?? false, // ✅ Offre de bienvenue
    availableToday: row.available_today ?? false, // ✅ Disponible cette semaine (effet urgence)
    curatedBadge: row.curated_badge ?? null, // Johari 8.1 : "recommended" | "top_this_month" (manuel / admin)
  };
}

export async function fetchProviderServicesMap(providerIds) {
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


// 1) Filtre "nearby" (bounding box) si lat/lng/radius fournis. Si lat/lng sans radius → pas de filtre (tri par distance plus bas).
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

// Limite en DB seulement quand on ne trie pas par distance (sinon on trie puis slice après)
if (limit && (lat == null || lng == null)) {
  query = query.limit(Number(limit));
}

const { data, error } = await query;
if (error) throw error;

const providerIdSet = new Set();
if (Array.isArray(data)) {
  data.forEach(row => {
    getProviderIdentityKeys(row).forEach(idVal => providerIdSet.add(idVal));
  });
}
const servicesMap = await fetchProviderServicesMap([...providerIdSet]);

const mapped = data.map(row =>
  mapProviderRowToDetailer({
    ...row,
    providerServices: pickServicesForRow(row, servicesMap),
  })
);

// Disponibilité cette semaine = au moins un créneau libre (calendrier = horaires - résas)
const availableIds = await getProviderIdsWithAvailabilityThisWeek(data);
const mappedWithAvailability = mapped.map((d) => ({
  ...d,
  hasAvailabilityThisWeek: availableIds.has(String(d.id)),
}));

const effectiveSort = requestedSort ?? sort;
if (effectiveSort === "rating,-priceMin") {
  mappedWithAvailability.sort((a, b) => {
    const rA = a.rating ?? 0;
    const rB = b.rating ?? 0;
    if (rA !== rB) {
      return rB - rA;
    }
    if (a.minPrice == null) return 1;
    if (b.minPrice == null) return -1;
    return a.minPrice - b.minPrice;
  });
}

// 3) Tri par distance quand lat/lng fournis (avec ou sans radius : plus proches en premier)
if (lat != null && lng != null) {
  const lat0 = Number(lat);
  const lng0 = Number(lng);
  const rKm = radius != null ? Number(radius) : null; // null = pas de filtre rayon

  const withDistance = mappedWithAvailability.map(p => {
    const dLatKm = (p.lat - lat0) * 111;
    const dLngKm = (p.lng - lng0) * 75;
    const approxKm = Math.sqrt(dLatKm * dLatKm + dLngKm * dLngKm);
    return { ...p, approxDistanceKm: approxKm };
  });

  let list = withDistance;
  if (rKm != null) {
    list = withDistance.filter(p => p.approxDistanceKm <= rKm);
    // Fallback : si le rayon exclut tout le monde, on renvoie quand même la liste triée par distance
    // pour que "Nearby" et "Disponible cette semaine" affichent des résultats.
    if (list.length === 0) {
      list = withDistance;
    }
  }
  list.sort((a, b) => a.approxDistanceKm - b.approxDistanceKm);
  if (limit) {
    list = list.slice(0, Number(limit));
  }
  return list.map(({ approxDistanceKm, ...rest }) => rest);
}

return mappedWithAvailability;
}

// 🟦 Services d’un prestataire
export async function getProviderServices(providerId) {
  // 1) Récupérer les services
  const { data: services, error: servicesError } = await supabase
    .from("services")
    .select("*")
    .eq("provider_id", providerId)
    .order("price", { ascending: true });

  if (servicesError) throw servicesError;
  if (!services || services.length === 0) return [];

  // 2) 🆕 Calculer le nombre de réservations par service
  const serviceIds = services.map(s => s.id);
  
  // Compter les bookings par service_id (via booking_services si la table existe, sinon via service_id direct)
  const { data: bookingCounts, error: countsError } = await supabase
    .from("bookings")
    .select("service_id")
    .in("service_id", serviceIds)
    .in("status", ["confirmed", "started", "in_progress", "completed"]); // Seulement les bookings actifs/terminés

  if (countsError) {
    console.warn("[PROVIDER SERVICES] Error counting bookings:", countsError);
    // Si erreur, retourner les services sans reservation_count
    return services.map(s => ({ ...s, reservation_count: 0 }));
  }

  // 3) Compter par service_id
  const countsMap = new Map();
  (bookingCounts || []).forEach(booking => {
    if (booking.service_id) {
      countsMap.set(booking.service_id, (countsMap.get(booking.service_id) || 0) + 1);
    }
  });

  // 4) Ajouter reservation_count et garantir image_url (pour affichage page détail public)
  return services.map(service => ({
    ...service,
    reservation_count: countsMap.get(service.id) || 0,
    image_url: service.image_url ?? null,
  }));
}

export async function createProviderService(userId, service) {
  const { data: provider, error: providerLookupError } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (providerLookupError) throw providerLookupError;
  if (!provider) {
    const err = new Error("Provider profile not found");
    err.statusCode = 404;
    throw err;
  }

  const providerProfileId = provider.id ?? provider.user_id;
  if (!providerProfileId) {
    const err = new Error("Provider profile identifier missing");
    err.statusCode = 400;
    throw err;
  }

  // 🆕 Gérer les catégories multiples
  let categoryValue = service.category;
  let categoriesArray = [];
  
  if (Array.isArray(service.categories) && service.categories.length > 0) {
    categoryValue = service.categories[0];
    categoriesArray = service.categories;
  } else if (service.category) {
    categoryValue = service.category;
    categoriesArray = [service.category];
  } else {
    categoryValue = "carCleaning";
    categoriesArray = ["carCleaning"];
  }

  // 1️⃣ Insert dans Supabase
  const insertPayload = {
    provider_id: providerProfileId,
    name: service.name,
    category: categoryValue, // Première catégorie pour compatibilité
    price: service.price,
    duration_minutes: service.duration_minutes,
    description: service.description,
    is_available: service.is_available,
    image_url: service.image_url,
    currency: service.currency || "eur",
  };
  
  // 🆕 Ajouter categories si fourni
  if (categoriesArray.length > 0) {
    insertPayload.categories = categoriesArray;
  }
  
  let { data, error } = await supabase
    .from("services")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    if (error.code === "42703" && error.message?.includes("categories")) {
      delete insertPayload.categories;
      const retry = await supabase
        .from("services")
        .insert(insertPayload)
        .select()
        .single();
      if (retry.error) throw retry.error;
      data = retry.data;
    } else {
      throw error;
    }
  }

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
    // On ne bloque JAMAIS la création d'un service si Stripe tombe
    return {
      ...data,
      stripe_product_id: null,
      stripe_price_id: null,
      stripeError: true,
    };
  }
}

// 🟦 Mettre à jour un service d'un prestataire
export async function updateProviderService(serviceId, userId, updates) {
  // 1) Vérifier que le provider existe
  const { data: provider, error: providerError } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (providerError) throw providerError;
  if (!provider) {
    const err = new Error("Provider profile not found");
    err.statusCode = 404;
    throw err;
  }

  const providerProfileId = provider.id ?? provider.user_id;

  // 2) Vérifier que le service appartient à ce provider
  const { data: existingService, error: serviceError } = await supabase
    .from("services")
    .select("id, provider_id")
    .eq("id", serviceId)
    .single();

  if (serviceError) throw serviceError;
  if (!existingService) {
    const err = new Error("Service not found");
    err.statusCode = 404;
    throw err;
  }

  // Vérifier que le service appartient à ce provider
  if (existingService.provider_id !== providerProfileId) {
    const err = new Error("Forbidden: Service does not belong to this provider");
    err.statusCode = 403;
    throw err;
  }

  // 3) 🆕 Gérer les catégories multiples
  let categoryValue;
  let categoriesArray = [];
  
  if (Array.isArray(updates.categories) && updates.categories.length > 0) {
    categoryValue = updates.categories[0];
    categoriesArray = updates.categories;
  } else if (updates.category) {
    categoryValue = updates.category;
    categoriesArray = [updates.category];
  } else {
    // Garder les catégories existantes si non fournies (select category only pour éviter 42703 si colonne categories absente)
    const { data: currentService } = await supabase
      .from("services")
      .select("category")
      .eq("id", serviceId)
      .single();
    
    if (currentService) {
      categoryValue = currentService.category;
      categoriesArray = Array.isArray(currentService.categories) ? currentService.categories : (currentService.category ? [currentService.category] : []);
    } else {
      categoryValue = "carCleaning";
      categoriesArray = ["carCleaning"];
    }
  }

  // 4) Mettre à jour le service
  const updatePayload = {
    name: updates.name,
    category: categoryValue, // Première catégorie pour compatibilité
    description: updates.description,
    price: updates.price,
    duration_minutes: updates.duration_minutes,
    is_available: updates.is_available,
    image_url: updates.image_url,
    currency: updates.currency || "eur",
  };

  // 🆕 Ajouter categories si fourni
  if (categoriesArray.length > 0) {
    updatePayload.categories = categoriesArray;
  }

  // Template d'étapes (steps_template / stepsTemplate), max 6
  const rawSteps = updates.steps_template ?? updates.stepsTemplate;
  if (rawSteps !== undefined) {
    if (Array.isArray(rawSteps) && rawSteps.length > 0) {
      updatePayload.steps_template = rawSteps.slice(0, 6).map((s, i) => ({
        id: s.id ?? `step_${i + 1}`,
        label: s.label ?? s.title ?? `Étape ${i + 1}`,
        order: s.order ?? i + 1,
        percentage: Number(s.percentage) ?? Math.round(100 / rawSteps.length),
      }));
    } else {
      updatePayload.steps_template = null;
    }
  }

  // Enlever les undefined
  Object.keys(updatePayload).forEach((key) => {
    if (updatePayload[key] === undefined) {
      delete updatePayload[key];
    }
  });

  let { data, error } = await supabase
    .from("services")
    .update(updatePayload)
    .eq("id", serviceId)
    .select()
    .single();

  if (error) {
    if (error.code === "42703" && error.message?.includes("categories")) {
      delete updatePayload.categories;
      const retry = await supabase
        .from("services")
        .update(updatePayload)
        .eq("id", serviceId)
        .select()
        .single();
      if (retry.error) throw retry.error;
      data = retry.data;
    } else {
      throw error;
    }
  }

  // 5) 🆕 Si le prix a changé, mettre à jour le produit Stripe
  if (updates.price && updates.price !== existingService.price) {
    try {
      await ensureStripeProductForService(data.id);
    } catch (stripeError) {
      console.warn("[SERVICE] Stripe product update failed:", stripeError);
      // Ne pas bloquer la mise à jour si Stripe échoue
    }
  }

  return data;
}

// 🟦 Supprimer un service d'un prestataire
export async function deleteProviderService(serviceId, userId) {
  // 1) Vérifier que le provider existe
  const { data: provider, error: providerError } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (providerError) throw providerError;
  if (!provider) {
    const err = new Error("Provider profile not found");
    err.statusCode = 404;
    throw err;
  }

  const providerProfileId = provider.id ?? provider.user_id;

  // 2) Vérifier que le service appartient à ce provider
  const { data: service, error: serviceError } = await supabase
    .from("services")
    .select("id, provider_id")
    .eq("id", serviceId)
    .single();

  if (serviceError) {
    if (serviceError.code === "PGRST116") {
      // Service not found
      const err = new Error("Service not found");
      err.statusCode = 404;
      throw err;
    }
    throw serviceError;
  }

  if (service.provider_id !== providerProfileId) {
    const err = new Error("Forbidden: Service does not belong to this provider");
    err.statusCode = 403;
    throw err;
  }

  // 3) Supprimer le service
  const { error: deleteError } = await supabase
    .from("services")
    .delete()
    .eq("id", serviceId);

  if (deleteError) throw deleteError;

  return true;
}

// 🟦 Détail d’un prestataire
export async function getProviderById(providerId) {
  const profile = await fetchProviderProfileByAnyId(providerId);

  if (!profile) {
    return null;
  }

  const identityKeys = getProviderIdentityKeys(profile);
  const servicesMap = await fetchProviderServicesMap(identityKeys);
  return mapProviderRowToDetailer({
    ...profile,
    providerServices: pickServicesForRow(profile, servicesMap),
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
    has_garage: updates.has_garage,
    min_price: updates.min_price,
    services: updates.services,
    team_size: updates.team_size,
    years_of_experience: updates.years_of_experience,
    logo_url: updates.logo_url,
    banner_url: updates.banner_url,
    phone: updates.phone,
    email: updates.email,
    opening_hours: updates.opening_hours,
    available_today: updates.availableToday,
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


export async function getProviderProfileIdForUser(userId) {
  const { data, error } = await supabase
    .from("provider_profiles")
    .select("user_id, rating")
    .eq("user_id", userId)
    .single();

  if (error) throw error;

  // consistent object teruggeven
  return { id: data.user_id, rating: data.rating };
}


// 🟦 Stats provider
export async function getProviderStats(userId) {
  const provider = await getProviderProfileIdForUser(userId);
  if (!provider?.id) {
    const err = new Error("Provider profile not found");
    err.statusCode = 404;
    throw err;
  }

 const providerId = userId;
  const rating = provider.rating ?? 0;

  const now = new Date();
  const startOfThisMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  );
  const startOfLastMonth = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1
  );

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("price, customer_id, created_at")
    .eq("provider_id", providerId)
    .eq("payment_status", "paid")
    .gte("created_at", startOfLastMonth.toISOString());

  if (error) throw error;

  let thisMonthEarnings = 0;
  let lastMonthEarnings = 0;
  let thisMonthReservations = 0;
  const clientsSet = new Set();

  bookings.forEach(b => {
    const createdAt = new Date(b.created_at);

    if (createdAt >= startOfThisMonth) {
      thisMonthEarnings += Number(b.price);
      thisMonthReservations += 1;
      clientsSet.add(b.customer_id);
    } else if (createdAt >= startOfLastMonth) {
      lastMonthEarnings += Number(b.price);
    }
  });

  let variationPercent = 0;
  if (lastMonthEarnings > 0) {
    variationPercent =
      ((thisMonthEarnings - lastMonthEarnings) / lastMonthEarnings) * 100;
  } else if (thisMonthEarnings > 0) {
    variationPercent = 100;
  }

  return {
    monthlyEarnings: Math.round(thisMonthEarnings * 100) / 100,
    variationPercent: Math.round(variationPercent),
    reservationsCount: thisMonthReservations,
    rating,
    clientsCount: clientsSet.size,
  };
}

/**
 * Séries temporelles pour graphiques (revenus et nombre de résas par jour/semaine/mois).
 * period: "week" | "month" | "year"
 */
export async function getProviderStatsSeries(userId, period) {
  const provider = await getProviderProfileIdForUser(userId);
  if (!provider?.id) {
    const err = new Error("Provider profile not found");
    err.statusCode = 404;
    throw err;
  }
  const providerId = userId;

  const now = new Date();
  let startDate;
  let groupBy = "day";
  let labelFormat = "d";

  if (period === "week") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);
    groupBy = "day";
    labelFormat = "d";
  } else if (period === "month") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 0);
    startDate.setMonth(startDate.getMonth() - 1);
    startDate.setHours(0, 0, 0, 0);
    groupBy = "day";
    labelFormat = "d";
  } else {
    startDate = new Date(now.getFullYear(), 0, 1);
    startDate.setHours(0, 0, 0, 0);
    groupBy = "month";
    labelFormat = "M";
  }

  const startIso = startDate.toISOString();

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("price, created_at")
    .eq("provider_id", providerId)
    .eq("payment_status", "paid")
    .gte("created_at", startIso);

  if (error) throw error;

  const revenueByKey = new Map();
  const countByKey = new Map();

  (bookings || []).forEach((b) => {
    const d = new Date(b.created_at);
    let key;
    if (groupBy === "day") {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    revenueByKey.set(key, (revenueByKey.get(key) || 0) + Number(b.price));
    countByKey.set(key, (countByKey.get(key) || 0) + 1);
  });

  const allKeys = new Set([...revenueByKey.keys(), ...countByKey.keys()]);
  const sortedKeys = [...allKeys].sort();

  const revenue = sortedKeys.map((key) => ({
    label: key,
    value: Math.round((revenueByKey.get(key) || 0) * 100) / 100,
  }));
  const bookingsSeries = sortedKeys.map((key) => ({
    label: key,
    value: countByKey.get(key) || 0,
  }));

  return { revenue, bookings: bookingsSeries };
}

/**
 * Services les plus réservés pour le provider (avec CA estimé et nombre de résas).
 */
export async function getProviderPopularServices(userId, period) {
  const provider = await getProviderProfileIdForUser(userId);
  if (!provider?.id) {
    const err = new Error("Provider profile not found");
    err.statusCode = 404;
    throw err;
  }
  const providerId = userId;

  const now = new Date();
  let startIso;
  if (period === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    startIso = start.toISOString();
  } else if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    startIso = start.toISOString();
  } else {
    const start = new Date(now.getFullYear(), 0, 1);
    startIso = start.toISOString();
  }

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("service_id, service_name, price")
    .eq("provider_id", providerId)
    .eq("payment_status", "paid")
    .gte("created_at", startIso);

  if (error) throw error;

  const byName = new Map();
  (bookings || []).forEach((b) => {
    const name = b.service_name || "Service";
    const existing = byName.get(name) || { count: 0, earnings: 0 };
    existing.count += 1;
    existing.earnings += Number(b.price || 0);
    byName.set(name, existing);
  });

  const popular = [...byName.entries()]
    .map(([name, { count, earnings }]) => ({
      name,
      count,
      estimatedEarnings: Math.round(earnings * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return popular;
}
