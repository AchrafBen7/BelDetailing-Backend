// src/controllers/provider.controller.js
import {
  getAllProviders,
  getProviderById,
  getProviderServices,
  getProviderReviews,
  getProviderStats,
} from "../services/provider.service.js";

export async function listProviders(req, res) {
  try {
    const providers = await getAllProviders();
    // iOS: APIResponse<[Detailer]> → on renvoie un array direct
   return res.json({ data: providers });
  } catch (err) {
    console.error("[PROVIDERS] listProviders error:", err);
    return res.status(500).json({ error: "Could not fetch providers" });
  }
}  

export async function getProvider(req, res) {
  try {
    const { id } = req.params;
    const provider = await getProviderById(id);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }
    // iOS: APIResponse<Detailer>
    return res.json(provider);
  } catch (err) {
    console.error("[PROVIDERS] getProvider error:", err);
    return res.status(500).json({ error: "Could not fetch provider" });
  }
}

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

export async function getProviderStatsController(req, res) {
  try {
    const { id } = req.params;
    const stats = await getProviderStats(id);

    if (!stats) {
      return res.json({
        monthlyEarnings: 0,
        variationPercent: 0,
        reservationsCount: 0,
        rating: 0,
        clientsCount: 0
      });
    }

    return res.json(stats);

  } catch (err) {
    console.error("[PROVIDERS] getProviderStats error:", err);
    return res.status(500).json({ error: "Could not fetch stats" });
  }
}

