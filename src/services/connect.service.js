// src/services/connect.service.js
import Stripe from "stripe";
import { supabase } from "../config/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

/**
 * Crée un compte Connect pour un provider (BelDetailing Pro)
 * et l'enregistre dans provider_profiles.stripe_account_id
 */
export async function createOrGetStripeAccountForProvider(userId) {
  // 1) Vérifier si le provider a déjà un compte Stripe
  const { data: profile, error } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !profile) {
    throw new Error("Provider profile not found");
  }

  if (profile.stripe_account_id) {
    return { stripeAccountId: profile.stripe_account_id, created: false };
  }

  // 2) Créer un nouveau compte Stripe Connect (v2 + controller)
  const account = await stripe.accounts.create({
    controller: {
      fees: {
        payer: "application", // ta plateforme prend les fees
      },
      losses: {
        payments: "application", // tu portes le risque des chargebacks
      },
      stripe_dashboard: {
        type: "express",
      },
    },
    metadata: {
      provider_user_id: userId,
    },
  });

  // 3) Sauvegarder l'account_id dans provider_profiles
  const { error: updateError } = await supabase
    .from("provider_profiles")
    .update({ stripe_account_id: account.id })
    .eq("user_id", userId);

  if (updateError) {
    throw updateError;
  }

  return { stripeAccountId: account.id, created: true };
}
