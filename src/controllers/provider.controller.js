// src/controllers/provider.controller.js
import {
  getAllProviders,
  getProviderById,
  updateProviderProfile,
  createProviderService,
  getProviderServices,
  getProviderReviews,
  getProviderStats,
} from "../services/provider.service.js";

export async function listProviders(req, res) {
  try {
    const { sort, limit, lat, lng, radius } = req.query;

    const providers = await getAllProviders({
      sort,
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

// Update provider profile
export async function updateMyProviderProfile(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can update profile" });
    }

    const updated = await updateProviderProfile(req.user.id, req.body);
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

// Provider stats
export async function getProviderStatsController(req, res) {
  try {
    const stats = await getProviderStats(req.params.id);
    return res.json(stats);
  } catch (err) {
    console.error("[PROVIDERS] getProviderStats error:", err);
    return res.status(500).json({ error: "Could not fetch stats" });
  }
}
