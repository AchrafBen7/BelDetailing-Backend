// src/services/stripeProduct.service.js
import Stripe from "stripe";
import { supabase } from "../config/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

/**
 * Crée (ou récupère) le produit Stripe associé à un service BelDetailing.
 * - service.id → metadata.service_id
 * - provider_id → metadata.provider_id
 */
export async function ensureStripeProductForService(serviceId) {
  // 1) Charger le service
  const { data: service, error } = await supabase
    .from("services")
    .select("*")
    .eq("id", serviceId)
    .single();

  if (error || !service) {
    throw new Error("Service not found");
  }

  // 2) Si on a déjà un product/price Stripe → on renvoie
  if (service.stripe_product_id && service.stripe_price_id) {
    return {
      productId: service.stripe_product_id,
      priceId: service.stripe_price_id,
      currency: service.currency || "eur",
      amount: service.price,
    };
  }

  const currency = service.currency || "eur";
  const amountInCents = Math.round(service.price * 100);

  // 3) Créer le produit Stripe au niveau PLATEFORME
  const product = await stripe.products.create({
    name: service.name,
    description: service.description ?? undefined,
    default_price_data: {
      unit_amount: amountInCents,
      currency,
    },
    metadata: {
      service_id: service.id,
      provider_id: service.provider_id,
    },
  });

  // 4) product.default_price = id du price créé automatiquement
  const priceId =
    typeof product.default_price === "string"
      ? product.default_price
      : product.default_price.id;

  // 5) Sauvegarder dans la table services
  const { error: updateError } = await supabase
    .from("services")
    .update({
      stripe_product_id: product.id,
      stripe_price_id: priceId,
      currency,
    })
    .eq("id", service.id);

  if (updateError) {
    throw updateError;
  }

  return {
    productId: product.id,
    priceId,
    currency,
    amount: service.price,
  };
}
