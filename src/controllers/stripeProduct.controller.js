// src/controllers/stripeProduct.controller.js
import { ensureStripeProductForService } from "../services/stripeProduct.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";

export async function createStripeProductForServiceController(req, res) {
  try {
    const { id: serviceId } = req.params;

    // 🔒 SECURITY: Vérifier que le service appartient au provider connecté
    if (req.user.role !== "provider" && req.user.role !== "admin") {
      return res.status(403).json({ error: "Only providers can create Stripe products" });
    }

    const { data: service, error: serviceErr } = await supabase
      .from("services")
      .select("id, provider_id")
      .eq("id", serviceId)
      .maybeSingle();

    if (serviceErr || !service) {
      return res.status(404).json({ error: "Service not found" });
    }

    // Vérifier ownership: le provider_id du service doit correspondre au user connecté
    const { data: providerProfile } = await supabase
      .from("provider_profiles")
      .select("id, user_id")
      .eq("user_id", req.user.id)
      .maybeSingle();

    const providerProfileId = providerProfile?.id ?? providerProfile?.user_id;
    if (service.provider_id !== providerProfileId && service.provider_id !== req.user.id) {
      return res.status(403).json({ error: "This service does not belong to you" });
    }

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
