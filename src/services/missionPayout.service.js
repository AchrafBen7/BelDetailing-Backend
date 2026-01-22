// src/services/missionPayout.service.js
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";
import { getMissionAgreementById } from "./missionAgreement.service.js";
import { getMissionPaymentById, updateMissionPaymentStatus } from "./missionPayment.service.js";
import { logger } from "../observability/logger.js";
import { missionTransfersTotal, missionTransfersAmount } from "../observability/metrics.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

/**
 * 🟦 GET STRIPE CONNECTED ACCOUNT – Récupérer le Stripe Connected Account ID d'un detailer
 */
async function getStripeConnectedAccountId(detailerUserId) {
  const { data: providerProfile, error } = await supabase
    .from("provider_profiles")
    .select("stripe_account_id")
    .eq("user_id", detailerUserId)
    .maybeSingle();

  if (error) throw error;

  if (!providerProfile?.stripe_account_id) {
    throw new Error("Provider does not have a Stripe Connect account. Please complete onboarding first.");
  }

  return providerProfile.stripe_account_id;
}

/**
 * 🟦 CREATE TRANSFER – Créer un transfert Stripe vers le detailer (après capture d'un paiement)
 * 
 * @param {Object} params
 * @param {string} params.missionAgreementId - ID du Mission Agreement
 * @param {string} params.paymentId - ID du paiement capturé (mission_payments)
 * @param {number} params.amount - Montant à transférer (en euros, avant commission)
 * @param {number} params.commissionRate - Taux de commission NIOS (optionnel, default: MISSION_COMMISSION_RATE = 7%)
 * @returns {Promise<Object>} Transfer créé
 */
export async function createTransferToDetailer({
  missionAgreementId,
  paymentId,
  amount,
  commissionRate = MISSION_COMMISSION_RATE, // 7% pour les missions
}) {
  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  // 2) Vérifier que le Stripe Connected Account ID existe
  if (!agreement.stripeConnectedAccountId) {
    throw new Error("Detailer Stripe Connected Account ID not found. Please complete Stripe Connect onboarding first.");
  }

  // 3) Calculer le montant net (après commission)
  const commissionAmount = Math.round(amount * commissionRate * 100) / 100;
  const netAmount = Math.round((amount - commissionAmount) * 100) / 100;

  // 4) Récupérer le Payment Intent ID du paiement
  const payment = await getMissionPaymentById(paymentId);
  if (!payment || !payment.stripePaymentIntentId) {
    throw new Error("Payment Intent not found for this payment");
  }

  // 5) Récupérer le Charge ID depuis le Payment Intent
  const paymentIntent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
  const chargeId = paymentIntent.latest_charge;

  if (!chargeId || typeof chargeId !== "string") {
    throw new Error("Charge ID not found in Payment Intent");
  }

  // 6) Créer le transfert vers le Connected Account du detailer
  const transfer = await stripe.transfers.create(
    {
      amount: Math.round(netAmount * 100), // Convertir en centimes
      currency: "eur",
      destination: agreement.stripeConnectedAccountId,
      source_transaction: chargeId, // Lier au charge original
      metadata: {
        missionAgreementId,
        paymentId,
        commissionRate: commissionRate.toString(),
        commissionAmount: commissionAmount.toString(),
        netAmount: netAmount.toString(),
        source: "beldetailing-app",
      },
    },
    {
      idempotencyKey: `transfer-${paymentId}-${Date.now()}`, // Éviter les doublons
    }
  );

  console.log(`✅ [MISSION PAYOUT] Transfer created: ${transfer.id} for payment ${paymentId}`);

  // 7) Mettre à jour le paiement avec le transfer ID (optionnel, pour tracking)
  // Note: On ne met pas à jour le statut ici, il sera mis à jour via webhook

  return {
    id: transfer.id,
    amount: transfer.amount / 100, // Reconvertir en euros
    currency: transfer.currency,
    destination: transfer.destination,
    commissionAmount,
    netAmount,
    status: transfer.reversed ? "reversed" : "paid",
    created: transfer.created,
  };
}

/**
 * 🟦 CREATE PAYOUT SUMMARY – Récapitulatif des payouts pour un detailer
 * 
 * @param {string} detailerUserId - ID du detailer
 * @param {string} missionAgreementId - ID du Mission Agreement (optionnel, pour filtrer)
 * @returns {Promise<Object>} Récapitulatif des payouts
 */
export async function getPayoutSummaryForDetailer(detailerUserId, missionAgreementId = null) {
  // 1) Récupérer le Stripe Connected Account ID
  const connectedAccountId = await getStripeConnectedAccountId(detailerUserId);

  // 2) Récupérer le solde du compte connecté
  const balance = await stripe.balance.retrieve({
    stripeAccount: connectedAccountId,
  });

  // 3) Récupérer les payouts récents
  const payouts = await stripe.payouts.list(
    {
      limit: 10,
    },
    {
      stripeAccount: connectedAccountId,
    }
  );

  // 4) Récupérer les transfers liés aux missions (si missionAgreementId fourni)
  let missionTransfers = [];
  if (missionAgreementId) {
    const { data: payments, error } = await supabase
      .from("mission_payments")
      .select("id, amount, type, status, stripe_payment_intent_id")
      .eq("mission_agreement_id", missionAgreementId)
      .eq("status", "captured");

    if (!error && payments) {
      // Note: On ne peut pas récupérer les transfers directement depuis Stripe
      // car ils ne sont pas liés aux Payment Intents dans les métadonnées
      // On peut seulement récupérer les payouts globaux
    }
  }

  return {
    balance: {
      available: balance.available.map((b) => ({
        amount: b.amount / 100,
        currency: b.currency,
      })),
      pending: balance.pending.map((b) => ({
        amount: b.amount / 100,
        currency: b.currency,
      })),
    },
    payouts: payouts.data.map((p) => ({
      id: p.id,
      amount: p.amount / 100,
      currency: p.currency,
      status: p.status,
      arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
      created: new Date(p.created * 1000).toISOString(),
    })),
  };
}

/**
 * 🟦 AUTO TRANSFER ON PAYMENT CAPTURE – Transférer automatiquement après capture d'un paiement
 * 
 * Cette fonction est appelée automatiquement après qu'un paiement de mission soit capturé.
 * Elle crée un transfert vers le detailer en déduisant la commission NIOS.
 * 
 * @param {string} paymentId - ID du paiement capturé (mission_payments)
 * @param {number} commissionRate - Taux de commission (optionnel, default: MISSION_COMMISSION_RATE = 7%)
 */
export async function autoTransferOnPaymentCapture(paymentId, commissionRate = MISSION_COMMISSION_RATE) {
  // 1) Récupérer le paiement
  const payment = await getMissionPaymentById(paymentId);
  if (!payment) {
    throw new Error("Payment not found");
  }

  if (payment.status !== "captured") {
    throw new Error(`Payment is not captured. Current status: ${payment.status}`);
  }

  // 2) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(payment.missionAgreementId);
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  // 3) Vérifier que le Connected Account existe
  if (!agreement.stripeConnectedAccountId) {
    const errorMessage = `No Stripe Connected Account for detailer ${agreement.detailerId}`;
    console.warn(`⚠️ [MISSION PAYOUT] ${errorMessage}`);
    
    // ✅ NOTIFIER L'ADMIN si le Connected Account manque
    try {
      const { notifyAdmin, logCriticalError } = await import("./adminNotification.service.js");
      logCriticalError({
        service: "MISSION PAYOUT",
        function: "autoTransferOnPaymentCapture",
        error: new Error(errorMessage),
        context: {
          paymentId,
          missionAgreementId: agreement.id,
          detailerId: agreement.detailerId,
          amount: payment.amount,
        },
      });
      
      await notifyAdmin({
        title: "Transfert échoué - Connected Account manquant",
        message: `Le transfert de ${payment.amount.toFixed(2)}€ pour le paiement ${paymentId} a échoué car le detailer n'a pas de Stripe Connected Account configuré.`,
        type: "transfer_failed_no_account",
        context: {
          paymentId,
          missionAgreementId: agreement.id,
          detailerId: agreement.detailerId,
          amount: payment.amount,
        },
      });
    } catch (notifError) {
      console.error("[MISSION PAYOUT] Failed to notify admin:", notifError);
    }
    
    return null; // Ne pas faire échouer, juste logger
  }

  // 4) Créer le transfert
  try {
    const transfer = await createTransferToDetailer({
      missionAgreementId: agreement.id,
      paymentId: payment.id,
      amount: payment.amount,
      commissionRate,
    });

    logger.info({ transferId: transfer.id, paymentId, missionAgreementId: agreement.id, amount: payment.amount, netAmount: transfer.netAmount }, "[MISSION PAYOUT] Auto-transfer created");
    
    // ✅ MÉTRIQUES : Incrémenter les compteurs de transferts
    missionTransfersTotal.inc({ status: "succeeded" });
    missionTransfersAmount.inc({ status: "succeeded" }, transfer.netAmount);

    return transfer;
  } catch (err) {
    // ✅ LOGGING AMÉLIORÉ avec contexte détaillé
    const { logCriticalError, notifyAdmin } = await import("./adminNotification.service.js");
    
    logCriticalError({
      service: "MISSION PAYOUT",
      function: "autoTransferOnPaymentCapture",
      error: err,
      context: {
        paymentId,
        missionAgreementId: agreement.id,
        detailerId: agreement.detailerId,
        amount: payment.amount,
        commissionRate,
        stripeConnectedAccountId: agreement.stripeConnectedAccountId,
      },
    });

    // ✅ ENREGISTRER L'ÉCHEC DANS LA TABLE failed_transfers pour retry automatique
    try {
      const { recordFailedTransfer } = await import("./failedTransfer.service.js");
      await recordFailedTransfer({
        missionAgreementId: agreement.id,
        paymentId: payment.id,
        detailerId: agreement.detailerId,
        stripeConnectedAccountId: agreement.stripeConnectedAccountId,
        amount: payment.amount,
        commissionRate,
        error: err,
      });
      console.log(`📝 [MISSION PAYOUT] Failed transfer recorded for payment ${paymentId}`);
    } catch (recordError) {
      console.error("[MISSION PAYOUT] Failed to record failed transfer:", recordError);
      // Continuer même si l'enregistrement échoue
    }

    // ✅ NOTIFIER L'ADMIN en cas d'échec de transfert (première tentative)
    try {
      await notifyAdmin({
        title: "Transfert échoué",
        message: `Le transfert de ${payment.amount.toFixed(2)}€ pour le paiement ${paymentId} a échoué. Un retry automatique sera tenté. Erreur: ${err.message}`,
        type: "transfer_failed",
        context: {
          paymentId,
          missionAgreementId: agreement.id,
          detailerId: agreement.detailerId,
          amount: payment.amount,
          error: err.message,
        },
      });
    } catch (notifError) {
      console.error("[MISSION PAYOUT] Failed to notify admin:", notifError);
    }

    // Ne pas faire échouer le processus, juste logger l'erreur
    // Le transfert sera retenté automatiquement via cron job
    return null;
  }
}

/**
 * 🟦 CHECK CONNECTED ACCOUNT STATUS – Vérifier le statut du compte connecté (charges_enabled, payouts_enabled)
 * 
 * @param {string} detailerUserId - ID du detailer
 * @returns {Promise<Object>} Statut du compte connecté
 */
export async function checkConnectedAccountStatus(detailerUserId) {
  const connectedAccountId = await getStripeConnectedAccountId(detailerUserId);

  const account = await stripe.accounts.retrieve(connectedAccountId);

  return {
    id: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    email: account.email,
    requirements: {
      currentlyDue: account.requirements?.currently_due || [],
      eventuallyDue: account.requirements?.eventually_due || [],
      pastDue: account.requirements?.past_due || [],
    },
  };
}
