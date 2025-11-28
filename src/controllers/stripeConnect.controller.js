// src/controllers/stripeConnect.controller.js
import {
  createOrGetConnectedAccount,
  createOnboardingLink,
  getConnectedAccountStatus,
  getProviderBalanceAndPayouts,
} from "../services/stripeConnect.service.js";

/**
 * POST /api/v1/stripe/connect/account
 * → Crée ou retourne le compte connecté du provider courant.
 */
export async function createOrGetAccountController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can have Stripe accounts" });
    }

    const { stripeAccountId, created } = await createOrGetConnectedAccount(req.user.id);

    return res.json({
      stripeAccountId,
      created,
    });
  } catch (err) {
    console.error("[STRIPE CONNECT] createOrGetAccount error:", err);
    return res.status(500).json({ error: "Could not create or fetch Stripe account" });
  }
}

/**
 * POST /api/v1/stripe/connect/onboarding-link
 * → Retourne une URL Stripe pour commencer / recommencer l'onboarding.
 */
export async function createOnboardingLinkController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can onboard to Stripe" });
    }

    const { stripeAccountId } = await createOrGetConnectedAccount(req.user.id);
    const url = await createOnboardingLink(stripeAccountId);

    return res.json({ url });
  } catch (err) {
    console.error("[STRIPE CONNECT] onboardingLink error:", err);
    return res.status(500).json({ error: "Could not create onboarding link" });
  }
}

/**
 * GET /api/v1/stripe/connect/account-status
 * → Récupère le status temps-réel du compte connecté.
 */
export async function getAccountStatusController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can have Stripe accounts" });
    }

    const { stripeAccountId } = await createOrGetConnectedAccount(req.user.id);
    const status = await getConnectedAccountStatus(stripeAccountId);

    return res.json(status);
  } catch (err) {
    console.error("[STRIPE CONNECT] accountStatus error:", err);
    return res.status(500).json({ error: "Could not fetch Stripe account status" });
  }
}

export async function getPayoutSummaryController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res
        .status(403)
        .json({ error: "Only providers can view payouts" });
    }

    const { stripeAccountId } = await createOrGetConnectedAccount(req.user.id);

    const summary = await getProviderBalanceAndPayouts(stripeAccountId);

    return res.json(summary);
  } catch (err) {
    console.error("[STRIPE CONNECT] payoutSummary error:", err);
    return res.status(500).json({ error: "Could not fetch payouts summary" });
  }
}