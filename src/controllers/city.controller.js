// src/controllers/city.controller.js
import {
  getAllCities,
  searchCityByName,
  getCityById,
  getNearbyCities,
} from "../services/city.service.js";

export async function listCities(req, res) {
  try {
    const items = await getAllCities();
    return res.json({ data: items });
  } catch (err) {
    console.error("[CITIES] list error:", err);
    return res.status(500).json({ error: "Could not fetch cities" });
  }
}

export async function searchCities(req, res) {
  try {
    const { q } = req.query;
    const items = await searchCityByName(q);
    return res.json({ data: items });
  } catch (err) {
    console.error("[CITIES] search error:", err);
    return res.status(500).json({ error: "Could not search cities" });
  }
}

export async function getCityDetail(req, res) {
  try {
    const { id } = req.params;
    const city = await getCityById(id);
    if (!city) return res.status(404).json({ error: "City not found" });
    return res.json(city);
  } catch (err) {
    console.error("[CITIES] detail error:", err);
    return res.status(500).json({ error: "Could not fetch city" });
  }
}

export async function nearbyCities(req, res) {
  try {
    const { lat, lng, radius } = req.query;
    const items = await getNearbyCities(lat, lng, radius);
    return res.json({ data: items });
  } catch (err) {
    console.error("[CITIES] nearby error:", err);
    return res.status(500).json({ error: "Could not fetch cities" });
  }
}
