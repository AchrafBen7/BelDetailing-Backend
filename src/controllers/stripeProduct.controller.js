// src/controllers/stripeProduct.controller.js
import { ensureStripeProductForService } from "../services/stripeProduct.service.js";

export async function createStripeProductForServiceController(req, res) {
  try {
    const { id: serviceId } = req.params;

    // Optionnel : vérifier que req.user.id == service.provider_id (ownership)
    const result = await ensureStripeProductForService(serviceId);

    return res.json({
      message: "Stripe product created / reused",
      ...result,
    });
  } catch (err) {
    console.error("[STRIPE PRODUCT ERROR]", err);
    return res.status(500).json({ error: "Could not create Stripe product" });
  }
}
