// src/controllers/product.controller.js
import {
  getProducts,
  getRecommendedProducts,
  trackProductClick,
} from "../services/product.service.js";

// GET /api/v1/products
export async function listProducts(req, res) {
  try {
    const { category, level, limit } = req.query;
    const items = await getProducts({ category, level, limit });
    return res.json({ data: items });
  } catch (err) {
    console.error("[PRODUCTS] list error:", err);
    return res.status(500).json({ error: "Could not fetch products" });
  }
}

// GET /api/v1/products/recommended
export async function listRecommendedProducts(req, res) {
  try {
    const items = await getRecommendedProducts();
    return res.json({ data: items });
  } catch (err) {
    console.error("[PRODUCTS] recommended error:", err);
    return res.status(500).json({ error: "Could not fetch recommended products" });
  }
}

// POST /api/v1/products/:id/click
export async function clickProduct(req, res) {
  try {
    await trackProductClick(req.params.id, req.user);
    return res.json({ success: true });
  } catch (err) {
    console.error("[PRODUCTS] click error:", err);
    return res.status(500).json({ error: "Could not track click" });
  }
}
