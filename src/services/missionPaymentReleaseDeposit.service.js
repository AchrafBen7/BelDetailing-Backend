// src/services/missionPaymentReleaseDeposit.service.js
/**
 * 🟦 RELEASE DEPOSIT AT J+1 – Libérer l'acompte au jour J+1
 * 
 * À J+1 (jour après le premier jour de mission), transférer l'acompte capturé au detailer
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Object>} Résultat du transfert
 */
import { getMissionAgreementById } from "./missionAgreement.service.js";
import { updateMissionPaymentStatus } from "./missionPayment.service.js";
import { autoTransferOnPaymentCapture } from "./missionPayout.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";

export async function releaseDepositAtJPlusOne(missionAgreementId) {
  console.log(`🔄 [RELEASE DEPOSIT] Releasing deposit for mission ${missionAgreementId} (J+1)`);

  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  // 2) Récupérer le paiement de l'acompte qui est en statut "captured_held"
  const { data: depositPayments, error: fetchError } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("mission_agreement_id", missionAgreementId)
    .eq("type", "deposit")
    .eq("status", "captured_held");

  if (fetchError) {
    console.error("❌ [RELEASE DEPOSIT] Error fetching deposit payment:", fetchError);
    throw fetchError;
  }

  if (!depositPayments || depositPayments.length === 0) {
    console.log(`⚠️ [RELEASE DEPOSIT] No deposit payment found in "captured_held" status for mission ${missionAgreementId}`);
    return {
      alreadyReleased: true,
      message: "Deposit already released or not found",
    };
  }

  const depositPayment = depositPayments[0];

  // 3) Vérifier que le PaymentIntent a bien été capturé
  if (!depositPayment.stripe_payment_intent_id) {
    throw new Error("Deposit payment missing PaymentIntent ID");
  }

  // 4) Vérifier que le Connected Account du detailer existe
  if (!agreement.stripeConnectedAccountId) {
    throw new Error("Detailer Stripe Connected Account ID not found. Cannot transfer deposit.");
  }

  // 5) Transférer l'acompte au detailer via Stripe Connect
  try {
    console.log(`🔄 [RELEASE DEPOSIT] Transferring ${depositPayment.amount}€ to detailer (Connected Account: ${agreement.stripeConnectedAccountId})`);
    
    // Pour l'acompte, on transfère le montant complet (pas de commission, déjà capturée séparément)
    const { createTransferToDetailer } = await import("./missionPayout.service.js");
    const transferResult = await createTransferToDetailer({
      missionAgreementId: agreement.id,
      paymentId: depositPayment.id,
      amount: depositPayment.amount,
      commissionRate: 0, // ✅ Pas de commission sur l'acompte (déjà capturée séparément)
    });

    // 6) Mettre à jour le statut du paiement à "transferred"
    await updateMissionPaymentStatus(depositPayment.id, "transferred", {
      transferredAt: new Date().toISOString(),
      stripeTransferId: transferResult.id || null,
    });

    console.log(`✅ [RELEASE DEPOSIT] Deposit released successfully: ${depositPayment.amount}€ transferred to detailer`);

    // 7) Envoyer notification au detailer
    try {
      const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
      await sendNotificationWithDeepLink({
        userId: agreement.detailerId,
        title: "💰 Acompte reçu",
        message: `Votre acompte de ${depositPayment.amount}€ pour "${agreement.title || 'la mission'}" a été versé sur votre compte bancaire.`,
        type: "mission_payment_received",
        id: missionAgreementId,
      });
    } catch (notifError) {
      console.error(`⚠️ [RELEASE DEPOSIT] Notification send failed:`, notifError);
    }

    return {
      success: true,
      amount: depositPayment.amount,
      transferId: transferResult.id || null,
      message: `Deposit of ${depositPayment.amount}€ released to detailer`,
    };

  } catch (transferError) {
    console.error(`❌ [RELEASE DEPOSIT] Error transferring deposit:`, transferError);
    throw transferError;
  }
}
