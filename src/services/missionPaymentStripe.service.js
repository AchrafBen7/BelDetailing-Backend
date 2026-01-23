// src/services/missionPaymentStripe.service.js
import Stripe from "stripe";
import { createSepaPaymentIntent, captureSepaPayment, cancelSepaPayment } from "./sepaDirectDebit.service.js";
import { createMissionPayment, updateMissionPaymentStatus } from "./missionPayment.service.js";
import {
  getMissionAgreementById,
  updateMissionAgreementStripeInfo,
  updateMissionAgreementStatus,
} from "./missionAgreement.service.js";
import { autoTransferOnPaymentCapture } from "./missionPayout.service.js";
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

  // ✅ VALIDATION SEPA : Vérifier que le SEPA mandate est actif
  const { getSepaMandate } = await import("./sepaDirectDebit.service.js");
  const sepaMandate = await getSepaMandate(agreement.companyId);

  if (!sepaMandate) {
    throw new Error("No SEPA mandate found. Please set up SEPA Direct Debit first.");
  }

  if (sepaMandate.status !== "active") {
    throw new Error(`SEPA mandate is not active. Current status: ${sepaMandate.status}. Please complete the SEPA setup.`);
  }

  // Vérifier que le mandate n'est pas expiré (si applicable)
  // Note: Les mandates SEPA Stripe n'expirent pas automatiquement, mais on peut vérifier la date de création
  // Pour l'instant, on se contente de vérifier le statut "active"

  // 3) Calculer la commission NIOS (7% pour les missions)
  const { MISSION_COMMISSION_RATE } = await import("../config/commission.js");
  const commissionAmount = Math.round(amount * MISSION_COMMISSION_RATE * 100) / 100; // 7% en centimes
  
  // 4) Créer le Payment Intent SEPA avec application_fee_amount
  const paymentIntent = await createSepaPaymentIntent({
    companyUserId: agreement.companyId,
    amount,
    currency: "eur",
    paymentMethodId: null, // Utilise le payment method par défaut
    applicationFeeAmount: Math.round(commissionAmount * 100), // En centimes pour Stripe
    metadata: {
      missionAgreementId,
      paymentId,
      paymentType: type,
      userId: agreement.companyId, // Pour les transactions
      type: "mission", // Pour identifier les paiements de missions
      commissionAmount: commissionAmount.toString(), // Pour le tracking
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

  // 5) Transférer automatiquement vers le detailer (après capture)
  try {
    const { MISSION_COMMISSION_RATE } = await import("../config/commission.js");
    await autoTransferOnPaymentCapture(paymentId, MISSION_COMMISSION_RATE); // 7% commission pour missions
  } catch (payoutError) {
    console.error(`❌ [MISSION PAYMENT] Auto-transfer failed for payment ${paymentId}:`, payoutError);
    // Ne pas faire échouer la capture si le transfert échoue
    // Le transfert pourra être retenté manuellement ou via webhook
  }

  // 6) Générer automatiquement les factures (company et detailer)
  try {
    const {
      generateCompanyInvoiceOnPaymentCapture,
      generateDetailerInvoiceOnPaymentCapture,
    } = await import("./missionInvoiceAuto.service.js");

    // Générer la facture pour la company
    await generateCompanyInvoiceOnPaymentCapture(paymentId);

    // Générer la facture de reversement pour le detailer
    await generateDetailerInvoiceOnPaymentCapture(paymentId);
  } catch (invoiceError) {
    console.error(`❌ [MISSION PAYMENT] Auto-invoice generation failed for payment ${paymentId}:`, invoiceError);
    // Ne pas faire échouer la capture si la génération des factures échoue
    // Les factures pourront être générées manuellement plus tard
  }

  // 7) ✅ ENVOYER NOTIFICATION AU DETAILER (paiement reçu)
  try {
    const agreement = await getMissionAgreementById(payment.mission_agreement_id);
    if (agreement && agreement.detailerId) {
      const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
      await sendNotificationWithDeepLink({
        userId: agreement.detailerId,
        title: "Paiement reçu",
        message: `Un paiement de ${payment.amount.toFixed(2)}€ a été reçu pour la mission "${agreement.title || 'votre mission'}"`,
        type: "mission_payment_received",
        id: paymentId,
      });
    }
  } catch (notifError) {
    console.error(`❌ [MISSION PAYMENT] Notification send failed for payment ${paymentId}:`, notifError);
    // Ne pas faire échouer la capture si la notification échoue
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

  // 4) ✅ ENVOYER NOTIFICATIONS (paiement échoué) → company + detailer
  try {
    const agreement = await getMissionAgreementById(payment.mission_agreement_id);
    if (agreement) {
      const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
      
      // Notification à la company
      if (agreement.companyId) {
        await sendNotificationWithDeepLink({
          userId: agreement.companyId,
          title: "Paiement échoué",
          message: `Le paiement de ${payment.amount.toFixed(2)}€ pour la mission "${agreement.title || 'votre mission'}" a échoué`,
          type: "mission_payment_failed",
          id: paymentId,
        });
      }
      
      // Notification au detailer
      if (agreement.detailerId) {
        await sendNotificationWithDeepLink({
          userId: agreement.detailerId,
          title: "Paiement échoué",
          message: `Le paiement de ${payment.amount.toFixed(2)}€ pour la mission "${agreement.title || 'votre mission'}" a échoué`,
          type: "mission_payment_failed",
          id: paymentId,
        });
      }
    }
  } catch (notifError) {
    console.error(`❌ [MISSION PAYMENT] Notification send failed for cancelled payment ${paymentId}:`, notifError);
    // Ne pas faire échouer l'annulation si la notification échoue
  }

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
