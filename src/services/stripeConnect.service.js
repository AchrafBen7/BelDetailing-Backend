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
 * 
 * ✅ NOUVEAU : Support pour provider_passionate avec compte "Individual"
 * - provider (pro) → Business account (avec TVA)
 * - provider_passionate → Individual account (sans TVA)
 */
export async function createOrGetConnectedAccount(providerUserId) {
  // 1) Récupérer le provider_profile et le rôle de l'utilisateur
  const { data: provider, error } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("user_id", providerUserId)
    .single();

  if (error || !provider) {
    throw new Error("Provider profile not found for this user");
  }

  // 2) Récupérer le rôle de l'utilisateur
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("role")
    .eq("id", providerUserId)
    .single();

  if (userError || !user) {
    throw new Error("User not found");
  }

  const userRole = user.role;

  // 3) Si on a déjà un stripe_account_id → on le retourne
  if (provider.stripe_account_id) {
    return { stripeAccountId: provider.stripe_account_id, created: false };
  }

  // 4) Créer un nouveau compte connecté selon le type
  let accountPayload;

  if (userRole === "provider_passionate") {
    // ✅ COMPTE INDIVIDUAL (passionné sans TVA)
    accountPayload = {
      type: "express",
      business_type: "individual", // ✅ Personne physique (pas de TVA requise)
      controller: {
        // La plateforme gère les frais
        fees: {
          payer: "application", // NIOS prend la commission via application_fee_amount
        },
        // La plateforme porte les pertes / refunds / chargebacks
        losses: {
          payments: "application",
        },
        // Dashboard Express pour le passionné
        stripe_dashboard: {
          type: "express",
        },
      },
      metadata: {
        provider_user_id: providerUserId,
        account_type: "individual", // Pour traçabilité
        user_role: "provider_passionate",
      },
    };
  } else {
    // ✅ COMPTE BUSINESS (provider pro avec TVA)
    accountPayload = {
      type: "express",
      business_type: "company", // ✅ Société (TVA requise)
      controller: {
        // La plateforme gère les frais
        fees: {
          payer: "application",
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
      metadata: {
        provider_user_id: providerUserId,
        account_type: "business",
        user_role: "provider",
      },
    };
  }

  const account = await stripe.accounts.create(accountPayload);

  // 5) On sauvegarde l'ID Stripe dans provider_profiles
  const { error: updateError } = await supabase
    .from("provider_profiles")
    .update({ stripe_account_id: account.id })
    .eq("user_id", providerUserId);

  if (updateError) {
    throw new Error("Could not save stripe_account_id in provider_profiles");
  }

  console.log(`✅ [STRIPE CONNECT] Account created for ${userRole}: ${account.id} (type: ${accountPayload.business_type})`);

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
