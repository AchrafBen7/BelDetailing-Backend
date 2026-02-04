// src/controllers/provider.controller.js
import {
  getAllProviders,
  getProviderById,
  updateProviderProfile,
  createProviderService,
  updateProviderService,
  deleteProviderService,
  getProviderServices,
  getProviderReviews,
  getProviderStats,
  getProviderStatsSeries,
  getProviderPopularServices,
  getProviderProfileIdForUser,
} from "../services/provider.service.js";
import { getAvailableSlotsForDate, getAvailableDaysInRange } from "../services/providerAvailability.service.js";
import { getSmartBookingProviders } from "../services/smartBooking.service.js";
import { invalidateProviderCache } from "../middlewares/cache.middleware.js";

/**
 * GET /api/v1/providers/smart-booking
 * Recherche en élargissant le rayon (5→100 km) jusqu'à trouver des détaileurs dispo.
 * Query: lat, lng, date (YYYY-MM-DD), preferred_hour (HH:mm ou "any"), service_at_provider (garage|mobile), duration_minutes
 */
export async function smartBookingProviders(req, res) {
  try {
    const lat = req.query.lat != null ? Number(req.query.lat) : null;
    const lng = req.query.lng != null ? Number(req.query.lng) : null;
    const date = req.query.date || null;
    const preferredHour = req.query.preferred_hour ?? req.query.preferredHour ?? "any";
    const serviceAtProvider = req.query.service_at_provider ?? req.query.serviceAtProvider ?? "garage";
    const durationMinutes = req.query.duration_minutes ?? req.query.durationMinutes ?? 60;

    const providers = await getSmartBookingProviders({
      customerLat: lat,
      customerLng: lng,
      date,
      preferredHour,
      serviceAtProvider,
      durationMinutes,
    });

    return res.json({ data: providers });
  } catch (err) {
    console.error("[PROVIDERS] smartBookingProviders error:", err);
    return res.status(500).json({ error: "Could not fetch smart booking providers" });
  }
}

export async function listProviders(req, res) {
  try {
    const { limit, lat, lng, radius } = req.query;
    const requestedSort = req.query.sort;
    const sanitizedSort =
      requestedSort === "rating,-priceMin" ? "rating" : requestedSort;

    const providers = await getAllProviders({
      sort: sanitizedSort,
      requestedSort,
      limit,
      lat: lat ? Number(lat) : undefined,
      lng: lng ? Number(lng) : undefined,
      radius: radius ? Number(radius) : undefined,
    });

    // ⬅️ heel belangrijk: direct array teruggeven
   return res.json({ data: providers });

  } catch (err) {
    console.error("[PROVIDERS] listProviders error:", err);
    return res.status(500).json({ error: "Could not fetch providers" });
  }
}

// Get provider by id
export async function getProvider(req, res) {
  try {
    const { id } = req.params;
    const provider = await getProviderById(id);

    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }

    return res.json(provider);
  } catch (err) {
    console.error("[PROVIDERS] getProvider error:", err);
    return res.status(500).json({ error: "Could not fetch provider" });
  }
}

/**
 * GET /api/v1/providers/:id/available-slots?date=YYYY-MM-DD&duration_minutes=120
 * Créneaux disponibles pour une date, basés sur horaires d'ouverture et résas déjà prises.
 */
export async function getAvailableSlotsController(req, res) {
  try {
    const { id: providerId } = req.params;
    const date = req.query.date;
    const durationMinutes = req.query.duration_minutes ?? req.query.durationMinutes ?? 60;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Query 'date' (YYYY-MM-DD) is required" });
    }

    const slots = await getAvailableSlotsForDate(
      providerId,
      date,
      Number(durationMinutes) || 60
    );
    return res.json({ data: slots });
  } catch (err) {
    console.error("[PROVIDERS] getAvailableSlots error:", err);
    return res.status(500).json({ error: "Could not fetch available slots" });
  }
}

/**
 * GET /api/v1/providers/:id/available-days?from=YYYY-MM-DD&to=YYYY-MM-DD&duration_minutes=60
 * Jours où le prestataire a au moins un créneau (pour Smart Booking "cette semaine").
 */
export async function getAvailableDaysController(req, res) {
  try {
    const { id: providerId } = req.params;
    const from = req.query.from;
    const to = req.query.to;
    const durationMinutes = req.query.duration_minutes ?? req.query.durationMinutes ?? 60;

    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: "Query 'from' and 'to' (YYYY-MM-DD) are required" });
    }

    const days = await getAvailableDaysInRange(
      providerId,
      from,
      to,
      Number(durationMinutes) || 60
    );
    return res.json({ data: days });
  } catch (err) {
    console.error("[PROVIDERS] getAvailableDays error:", err);
    return res.status(500).json({ error: "Could not fetch available days" });
  }
}

// Update provider profile
export async function updateMyProviderProfile(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can update profile" });
    }

    const updated = await updateProviderProfile(req.user.id, req.body);
    
    // Invalider le cache du provider modifié
    const provider = await getProviderProfileIdForUser(req.user.id);
    if (provider?.id) {
      await invalidateProviderCache(provider.id);
    }
    
    return res.json(updated);
  } catch (err) {
    console.error("[PROVIDERS] updateMyProviderProfile error:", err);
    return res.status(500).json({ error: "Could not update provider profile" });
  }
}

// Create a service
export async function createService(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can create services" });
    }

    const created = await createProviderService(req.user.id, req.body);
    return res.status(201).json(created);
  } catch (err) {
    console.error("[PROVIDERS] createService error:", err);
    return res.status(500).json({ error: "Could not create service" });
  }
}

// 🆕 Update a service
export async function updateService(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can update services" });
    }

    const { id } = req.params;
    const updated = await updateProviderService(id, req.user.id, req.body);
    return res.json(updated);
  } catch (err) {
    console.error("[PROVIDERS] updateService error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Could not update service" });
  }
}

// List provider services
export async function getProviderServicesController(req, res) {
  try {
    const { id } = req.params;
    const services = await getProviderServices(id);
    return res.json(services);
  } catch (err) {
    console.error("[PROVIDERS] getProviderServices error:", err);
    return res.status(500).json({ error: "Could not fetch services" });
  }
}

export async function getMyProviderServicesController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const provider = await getProviderProfileIdForUser(req.user.id);
    if (!provider?.id) {
      return res.status(404).json({ error: "Provider profile not found" });
    }

   const services = await getProviderServices(provider.id ?? req.user.id);
    return res.json(services);
  } catch (err) {
    console.error("[PROVIDERS] getMyProviderServices error:", err);
    return res.status(500).json({ error: "Could not fetch services" });
  }
}

// List provider reviews
export async function getProviderReviewsController(req, res) {
  try {
    const { id } = req.params;
    const reviews = await getProviderReviews(id);
    return res.json(reviews);
  } catch (err) {
    console.error("[PROVIDERS] getProviderReviews error:", err);
    return res.status(500).json({ error: "Could not fetch reviews" });
  }
}

export async function getMyProviderReviews(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const provider = await getProviderProfileIdForUser(req.user.id);
    if (!provider?.id) {
      return res.status(404).json({ error: "Provider profile not found" });
    }

    const reviews = await getProviderReviews(provider.id);
    return res.json(reviews);
  } catch (err) {
    console.error("[PROVIDERS] getMyReviews error:", err);
    return res.status(500).json({ error: "Could not fetch reviews" });
  }
}

// Provider stats
export async function getProviderStatsController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can access stats" });
    }

    const stats = await getProviderStats(req.user.id);
    return res.json(stats);
  } catch (err) {
    console.error("[PROVIDERS] getProviderStats error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not fetch stats" });
  }
}

export async function getMyProviderStatsController(req, res) {
  return getProviderStatsController(req, res);
}

// GET /api/v1/providers/me/stats/series?period=week|month|year
export async function getProviderStatsSeriesController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can access stats series" });
    }
    const period = req.query.period || "month";
    const series = await getProviderStatsSeries(req.user.id, period);
    return res.json(series);
  } catch (err) {
    console.error("[PROVIDERS] getProviderStatsSeries error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not fetch stats series" });
  }
}

// GET /api/v1/providers/me/stats/popular-services?period=week|month|year
export async function getProviderPopularServicesController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can access popular services" });
    }
    const period = req.query.period || "month";
    const popular = await getProviderPopularServices(req.user.id, period);
    return res.json({ data: popular });
  } catch (err) {
    console.error("[PROVIDERS] getProviderPopularServices error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not fetch popular services" });
  }
}

// Delete a service
export async function deleteServiceController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can delete services" });
    }

    const { id } = req.params;
    await deleteProviderService(id, req.user.id);
    return res.json({ success: true });
  } catch (err) {
    console.error("[PROVIDERS] deleteService error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Could not delete service" });
  }
}
