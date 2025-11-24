// src/controllers/service-category.controller.js
import { getServiceCategories } from "../services/service-category.service.js";

export async function listServiceCategories(req, res) {
  try {
    const items = await getServiceCategories();
    return res.json({ data: items });
  } catch (err) {
    console.error("[SERVICE_CATEGORIES] list error:", err);
    return res.status(500).json({ error: "Could not fetch service categories" });
  }
}
