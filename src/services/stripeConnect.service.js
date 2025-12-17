// src/services/stripeConnect.service.js
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";

// ⚠️ Vérifie que STRIPE_SECRET_KEY est bien dans ton .env
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY in environment variables");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

/**
 * Crée (ou récupère) un compte connecté Stripe pour un provider.
 * - providerUserId = user_id du provider dans ta DB (provider_profiles.user_id)
 */
export async function createOrGetConnectedAccount(providerUserId) {
  // 1) Récupérer le provider_profile
  const { data: provider, error } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("user_id", providerUserId)
    .single();

  if (error || !provider) {
    throw new Error("Provider profile not found for this user");
  }

  // 2) Si on a déjà un stripe_account_id → on le retourne
  if (provider.stripe_account_id) {
    return { stripeAccountId: provider.stripe_account_id, created: false };
  }

  // 3) Sinon, on crée un nouveau compte connecté avec le controller demandé
  const account = await stripe.accounts.create({
    controller: {
      // La plateforme gère les frais
      fees: {
        payer: "application", // ⚠️ NE PAS METTRE DE type EN TOP LEVEL
      },
      // La plateforme porte les pertes / refunds / chargebacks
      losses: {
        payments: "application",
      },
      // Dashboard Express pour le detailer
      stripe_dashboard: {
        type: "express",
      },
    },
  });

  // 4) On sauvegarde l'ID Stripe dans provider_profiles
  const { error: updateError } = await supabase
    .from("provider_profiles")
    .update({ stripe_account_id: account.id })
    .eq("user_id", providerUserId);

  if (updateError) {
    throw new Error("Could not save stripe_account_id in provider_profiles");
  }

  return { stripeAccountId: account.id, created: true };
}

/**
 * Génère un Account Link pour l'onboarding Express.
 * refreshUrl/callbackUrl viennent de ta config FRONTEND.
 */
export async function createOnboardingLink(stripeAccountId) {
  if (!process.env.FRONTEND_BASE_URL) {
    throw new Error("Missing FRONTEND_BASE_URL in env (for onboarding links)");
  }

  const refreshUrl = `${process.env.FRONTEND_BASE_URL}/onboarding/refresh`;
  const returnUrl = `${process.env.FRONTEND_BASE_URL}/onboarding/return`;

  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return accountLink.url;
}

/**
 * Retourne l'état en temps réel du compte connecté.
 * (charges_enabled, payouts_enabled, requirements…)
 */
export async function getConnectedAccountStatus(stripeAccountId) {
  const account = await stripe.accounts.retrieve(stripeAccountId);

  return {
    id: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    email: account.email ?? null,
    businessType: account.business_type ?? null,
    // Infos utiles pour ton UI
    requirements: {
      currentlyDue: account.requirements?.currently_due ?? [],
      eventuallyDue: account.requirements?.eventually_due ?? [],
      pastDue: account.requirements?.past_due ?? [],
    },
  };
}

export async function getProviderBalanceAndPayouts(stripeAccountId) {
  // Solde du compte connecté
  const balance = await stripe.balance.retrieve({
    stripeAccount: stripeAccountId,
  });

  // Prochains payouts
  const payouts = await stripe.payouts.list(
    {
      limit: 5,
    },
    {
      stripeAccount: stripeAccountId,
    }
  );

  return {
    available: balance.available ?? [],
    pending: balance.pending ?? [],
    payouts: payouts.data ?? [],
  };
}
