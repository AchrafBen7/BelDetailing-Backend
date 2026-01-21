// src/services/missionPaymentStripe.service.js
import Stripe from "stripe";
import { createSepaPaymentIntent, captureSepaPayment, cancelSepaPayment } from "./sepaDirectDebit.service.js";
import { createMissionPayment, updateMissionPaymentStatus } from "./missionPayment.service.js";
import {
  getMissionAgreementById,
  updateMissionAgreementStripeInfo,
  updateMissionAgreementStatus,
} from "./missionAgreement.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

/**
 * 🟦 CREATE PAYMENT INTENT FOR MISSION – Créer un Payment Intent Stripe pour un paiement de mission
 * 
 * @param {Object} params
 * @param {string} params.missionAgreementId - ID du Mission Agreement
 * @param {string} params.paymentId - ID du paiement (mission_payments)
 * @param {number} params.amount - Montant en euros
 * @param {string} params.type - Type de paiement (deposit, installment, final, monthly)
 * @returns {Promise<Object>} Payment Intent créé
 */
export async function createPaymentIntentForMission({
  missionAgreementId,
  paymentId,
  amount,
  type,
}) {
  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  // 2) Vérifier que le Stripe Customer ID existe
  if (!agreement.stripeCustomerId) {
    throw new Error("Company Stripe Customer ID not found. Please set up SEPA Direct Debit first.");
  }

  // 3) Créer le Payment Intent SEPA
  const paymentIntent = await createSepaPaymentIntent({
    companyUserId: agreement.companyId,
    amount,
    currency: "eur",
    paymentMethodId: null, // Utilise le payment method par défaut
    metadata: {
      missionAgreementId,
      paymentId,
      paymentType: type,
    },
  });

  // 4) Mettre à jour le paiement avec le Payment Intent ID
  await updateMissionPaymentStatus(paymentId, "authorized", {
    stripePaymentIntentId: paymentIntent.id,
    authorizedAt: new Date().toISOString(),
  });

  // 5) Si c'est le premier paiement (deposit), mettre à jour le Mission Agreement avec le Payment Intent principal
  if (type === "deposit" && !agreement.stripePaymentIntentId) {
    await updateMissionAgreementStripeInfo(missionAgreementId, {
      paymentIntentId: paymentIntent.id,
    });
  }

  return paymentIntent;
}

/**
 * 🟦 CAPTURE MISSION PAYMENT – Capturer un paiement de mission pré-autorisé
 * 
 * @param {string} paymentId - ID du paiement (mission_payments)
 * @returns {Promise<Object>} Paiement capturé
 */
export async function captureMissionPayment(paymentId) {
  // 1) Récupérer le paiement
  const { data: payment, error } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("id", paymentId)
    .single();

  if (error || !payment) {
    throw new Error("Mission Payment not found");
  }

  if (!payment.stripe_payment_intent_id) {
    throw new Error("No Payment Intent associated with this payment");
  }

  if (payment.status !== "authorized") {
    throw new Error(`Payment is not authorized. Current status: ${payment.status}`);
  }

  // 2) Capturer le paiement sur Stripe
  const result = await captureSepaPayment(payment.stripe_payment_intent_id);

  // 3) Mettre à jour le statut du paiement
  await updateMissionPaymentStatus(paymentId, "captured", {
    stripeChargeId: result.id, // Le Payment Intent ID devient le charge ID après capture
    capturedAt: new Date().toISOString(),
  });

  // 4) Si c'est le premier paiement capturé, activer le Mission Agreement
  if (payment.type === "deposit") {
    const agreement = await getMissionAgreementById(payment.mission_agreement_id);
    if (agreement && agreement.status === "draft") {
      await updateMissionAgreementStatus(agreement.id, "active");
    }
  }

  return {
    paymentId,
    status: "captured",
    amount: payment.amount,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * 🟦 CANCEL MISSION PAYMENT – Annuler un paiement de mission pré-autorisé
 * 
 * @param {string} paymentId - ID du paiement (mission_payments)
 * @returns {Promise<Object>} Paiement annulé
 */
export async function cancelMissionPayment(paymentId) {
  // 1) Récupérer le paiement
  const { data: payment, error } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("id", paymentId)
    .single();

  if (error || !payment) {
    throw new Error("Mission Payment not found");
  }

  if (!payment.stripe_payment_intent_id) {
    throw new Error("No Payment Intent associated with this payment");
  }

  if (payment.status !== "authorized") {
    throw new Error(`Payment cannot be cancelled. Current status: ${payment.status}`);
  }

  // 2) Annuler le paiement sur Stripe
  await cancelSepaPayment(payment.stripe_payment_intent_id);

  // 3) Mettre à jour le statut du paiement
  await updateMissionPaymentStatus(paymentId, "cancelled", {
    failedAt: new Date().toISOString(),
  });

  return {
    paymentId,
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
  };
}

/**
 * 🟦 CREATE INITIAL PAYMENTS – Créer les paiements initiaux (acompte + solde) pour une mission
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Array>} Liste des paiements créés
 */
export async function createInitialMissionPayments(missionAgreementId) {
  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  // 2) Vérifier qu'il n'y a pas déjà des paiements
  const { data: existingPayments, error: existingError } = await supabase
    .from("mission_payments")
    .select("id")
    .eq("mission_agreement_id", missionAgreementId);

  if (existingError) throw existingError;

  if (existingPayments && existingPayments.length > 0) {
    throw new Error("Payments already exist for this mission agreement");
  }

  const payments = [];

  // 3) Créer le paiement d'acompte
  if (agreement.depositAmount > 0) {
    const depositPayment = await createMissionPayment({
      missionAgreementId,
      type: "deposit",
      amount: agreement.depositAmount,
      scheduledDate: null, // Sera défini plus tard
    });
    payments.push(depositPayment);
  }

  // 4) Créer le paiement du solde
  if (agreement.remainingAmount > 0) {
    const finalPayment = await createMissionPayment({
      missionAgreementId,
      type: "final",
      amount: agreement.remainingAmount,
      scheduledDate: null, // Sera défini plus tard
    });
    payments.push(finalPayment);
  }

  return payments;
}
