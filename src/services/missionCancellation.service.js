// src/services/missionCancellation.service.js
/**
 * 🟦 MISSION CANCELLATION SERVICE – Gestion des annulations de missions
 * 
 * Règles critiques :
 * - Avant J+1 : Acompte non transféré → Refund automatique
 * - Après J+1 : Acompte déjà transféré → Pas de refund automatique (selon CGU)
 * - Commission : Conservée selon CGU (généralement non remboursable)
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @param {string} requestedBy - 'company' | 'detailer' | 'system'
 * @param {string} reason - Raison de l'annulation
 * @returns {Promise<Object>} Résultat de l'annulation
 */
import { getMissionAgreementById } from "./missionAgreement.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

export async function cancelMissionAgreement(missionAgreementId, requestedBy, reason) {
  console.log(`🔄 [MISSION CANCELLATION] Canceling mission ${missionAgreementId} (requested by: ${requestedBy})`);

  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  // 2) Vérifier que la mission peut être annulée
  if (agreement.status === "completed" || agreement.status === "cancelled") {
    throw new Error(`Mission cannot be canceled. Current status: ${agreement.status}`);
  }

  // 3) Vérifier si on est avant ou après J+1
  const startDate = new Date(agreement.startDate);
  const jPlusOne = new Date(startDate.getTime() + 24 * 60 * 60 * 1000); // J+1
  const now = new Date();
  const isBeforeJPlusOne = now < jPlusOne;

  console.log(`ℹ️ [MISSION CANCELLATION] Start date: ${startDate.toISOString()}, J+1: ${jPlusOne.toISOString()}, Now: ${now.toISOString()}`);
  console.log(`ℹ️ [MISSION CANCELLATION] Is before J+1: ${isBeforeJPlusOne}`);

  // 4) Récupérer les paiements de la mission
  const { data: payments, error: paymentsError } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("mission_agreement_id", missionAgreementId)
    .in("type", ["commission", "deposit"]);

  if (paymentsError) throw paymentsError;

  const depositPayment = payments?.find(p => p.type === "deposit");
  const commissionPayment = payments?.find(p => p.type === "commission");

  let refundResult = null;
  let transferCanceled = false;

  // 5) GESTION DU REMBOURSEMENT SELON LE TIMING
  if (isBeforeJPlusOne) {
    // ✅ AVANT J+1 : Acompte non transféré → Refund automatique
    console.log(`✅ [MISSION CANCELLATION] Before J+1: Deposit not yet transferred, refunding...`);

    if (depositPayment?.stripePaymentIntentId && depositPayment?.status === "succeeded") {
      try {
        // Créer un refund pour l'acompte
        const refund = await stripe.refunds.create({
          payment_intent: depositPayment.stripePaymentIntentId,
          amount: Math.round(depositPayment.amount * 100), // En centimes
          metadata: {
            missionAgreementId: agreement.id,
            paymentId: depositPayment.id,
            cancellationReason: reason,
            requestedBy: requestedBy,
            refundType: "deposit_before_j_plus_one",
          },
        });

        refundResult = {
          refundId: refund.id,
          amount: depositPayment.amount,
          type: "deposit",
          executedAt: new Date().toISOString(),
        };

        console.log(`✅ [MISSION CANCELLATION] Deposit refunded: ${refund.id}, amount: ${depositPayment.amount}€`);
      } catch (refundError) {
        console.error(`❌ [MISSION CANCELLATION] Error refunding deposit:`, refundError);
        throw new Error(`Could not refund deposit: ${refundError.message}`);
      }
    }

    // ✅ Commission : Conservée (non remboursable selon CGU)
    console.log(`ℹ️ [MISSION CANCELLATION] Commission (${commissionPayment?.amount || 0}€) is kept (non-refundable per terms)`);
  } else {
    // ✅ APRÈS J+1 : Acompte déjà transféré → Pas de refund automatique
    console.log(`⚠️ [MISSION CANCELLATION] After J+1: Deposit already transferred, no automatic refund`);
    console.log(`⚠️ [MISSION CANCELLATION] According to contract: "L'acompte est définitivement acquis au detailer à partir du jour J+1"`);

    // Vérifier si le transfer a été exécuté
    if (depositPayment?.stripeTransferId) {
      transferCanceled = false; // Transfer déjà exécuté, ne peut pas être annulé
      console.log(`ℹ️ [MISSION CANCELLATION] Transfer already executed: ${depositPayment.stripeTransferId}`);
    }
  }

  // 6) Mettre à jour le Mission Agreement
  const nowIso = new Date().toISOString();
  await supabase
    .from("mission_agreements")
    .update({
      status: "cancelled",
      cancellation_reason: reason,
      cancellation_requested_at: nowIso,
      cancellation_requested_by: requestedBy,
      refund_amount: refundResult?.amount || null,
      refund_executed_at: refundResult?.executedAt || null,
      refund_id: refundResult?.refundId || null,
      updated_at: nowIso,
    })
    .eq("id", missionAgreementId);

  // 7) Mettre à jour les paiements
  if (depositPayment) {
    await supabase
      .from("mission_payments")
      .update({
        status: isBeforeJPlusOne ? "refunded" : "transferred", // Si avant J+1 = refunded, sinon = transferred (déjà envoyé)
        refund_id: refundResult?.refundId || null,
        refunded_at: refundResult?.executedAt || null,
      })
      .eq("id", depositPayment.id);
  }

  // 8) ENVOYER NOTIFICATIONS
  try {
    const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
    
    // Notification à la company
    if (agreement.companyId) {
      const message = isBeforeJPlusOne
        ? `Mission "${agreement.title || 'votre mission'}" annulée. Acompte de ${depositPayment?.amount || 0}€ remboursé. Commission conservée selon CGU.`
        : `Mission "${agreement.title || 'votre mission'}" annulée. L'acompte a déjà été transféré au detailer (J+1 dépassé).`;

      await sendNotificationWithDeepLink({
        userId: agreement.companyId,
        title: "Mission annulée",
        message: message,
        type: "mission_cancelled",
        id: missionAgreementId,
      });
    }

    // Notification au detailer
    if (agreement.detailerId) {
      const message = isBeforeJPlusOne
        ? `Mission "${agreement.title || 'votre mission'}" annulée avant J+1. Acompte non transféré.`
        : `Mission "${agreement.title || 'votre mission'}" annulée. L'acompte vous a déjà été transféré.`;

      await sendNotificationWithDeepLink({
        userId: agreement.detailerId,
        title: "Mission annulée",
        message: message,
        type: "mission_cancelled",
        id: missionAgreementId,
      });
    }
  } catch (notifError) {
    console.error("[MISSION CANCELLATION] Notification send failed:", notifError);
  }

  return {
    success: true,
    missionAgreementId,
    canceledAt: nowIso,
    requestedBy,
    reason,
    isBeforeJPlusOne,
    refund: refundResult,
    transferCanceled,
    message: isBeforeJPlusOne
      ? "Mission annulée. Acompte remboursé. Commission conservée."
      : "Mission annulée. Acompte déjà transféré (J+1 dépassé).",
  };
}
