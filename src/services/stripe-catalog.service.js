// src/services/stripe-catalog.service.js
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

// ⚙️ Crée (ou réutilise) un product + price Stripe pour un service
export async function ensureStripeProductForService(serviceRow) {
  // Si déjà fait → on ne recrée pas
  if (serviceRow.stripe_product_id && serviceRow.stripe_price_id) {
    return serviceRow;
  }

  const currency = serviceRow.currency || "eur";

  // 1) Product
  const product = await stripe.products.create({
    name: serviceRow.name,
    description: serviceRow.description ?? "",
    metadata: {
      service_id: serviceRow.id,
      provider_id: serviceRow.provider_id,
    },
  });

  // 2) Price
  const price = await stripe.prices.create({
    unit_amount: Math.round(serviceRow.price * 100), // 75 → 7500
    currency,
    product: product.id,
  });

  // 3) On sauvegarde dans la table `services`
  const { data, error } = await supabase
    .from("services")
    .update({
      stripe_product_id: product.id,
      stripe_price_id: price.id,
      currency,
    })
    .eq("id", serviceRow.id)
    .select()
    .single();

  if (error) throw error;

  return data;
}
