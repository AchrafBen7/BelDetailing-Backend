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

  // 4) Vérifier si l'acompte a déjà été transféré via Stripe Connect (transfer_data)
  // Si le PaymentIntent a été créé avec transfer_data, l'acompte est déjà transféré au Connected Account
  // On vérifie cela en regardant les metadata du PaymentIntent
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-11-17.clover",
  });
  
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(depositPayment.stripe_payment_intent_id);
  } catch (err) {
    console.error(`❌ [RELEASE DEPOSIT] Error retrieving PaymentIntent:`, err);
    throw new Error("Could not retrieve PaymentIntent");
  }

  // 5) Vérifier si l'acompte a déjà été transféré via Stripe Connect
  // Si transfer_data existe dans le PaymentIntent, l'acompte a déjà été transféré automatiquement
  if (paymentIntent.transfer_data && paymentIntent.transfer_data.destination) {
    console.log(`ℹ️ [RELEASE DEPOSIT] Deposit already transferred via Stripe Connect (transfer_data) to Connected Account: ${paymentIntent.transfer_data.destination}`);
    console.log(`✅ [RELEASE DEPOSIT] No additional transfer needed. Updating status to "transferred".`);
    
    // Mettre à jour le statut à "transferred" sans créer de Transfer supplémentaire
    await updateMissionPaymentStatus(depositPayment.id, "transferred", {
      transferredAt: new Date().toISOString(),
      stripeTransferId: null, // Pas de Transfer séparé, le transfert a été fait automatiquement via Stripe Connect
    });

    // Envoyer notification au detailer (même si le transfert était déjà fait, on notifie à J+1)
    try {
      const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
      await sendNotificationWithDeepLink({
        userId: agreement.detailerId,
        title: "💰 Acompte disponible",
        message: `Votre acompte de ${depositPayment.amount}€ pour "${agreement.title || 'la mission'}" est maintenant disponible sur votre compte bancaire.`,
        type: "mission_payment_received",
        id: missionAgreementId,
      });
    } catch (notifError) {
      console.error(`⚠️ [RELEASE DEPOSIT] Notification send failed:`, notifError);
    }

    return {
      success: true,
      alreadyReleased: false,
      alreadyTransferred: true, // ✅ Indique que le transfert était déjà fait via Stripe Connect
      amount: depositPayment.amount,
      transferId: null, // Pas de Transfer séparé
      message: `Deposit of ${depositPayment.amount}€ was already transferred via Stripe Connect`,
    };
  }

  // 6) Si pas de transfer_data, créer un Transfer manuel (fallback pour les anciens paiements)
  console.log(`🔄 [RELEASE DEPOSIT] No transfer_data found. Creating manual transfer for ${depositPayment.amount}€ to detailer`);

  // 7) Vérifier que le Connected Account du detailer existe
  if (!agreement.stripeConnectedAccountId) {
    throw new Error("Detailer Stripe Connected Account ID not found. Cannot transfer deposit.");
  }

  // 8) Transférer l'acompte au detailer via Stripe Connect (Transfer manuel)
  try {
    const { createTransferToDetailer } = await import("./missionPayout.service.js");
    const transferResult = await createTransferToDetailer({
      missionAgreementId: agreement.id,
      paymentId: depositPayment.id,
      amount: depositPayment.amount,
      commissionRate: 0, // ✅ Pas de commission sur l'acompte (déjà capturée séparément)
    });

    // 9) Mettre à jour le statut du paiement à "transferred"
    await updateMissionPaymentStatus(depositPayment.id, "transferred", {
      transferredAt: new Date().toISOString(),
      stripeTransferId: transferResult.id || null,
    });

    console.log(`✅ [RELEASE DEPOSIT] Deposit released successfully: ${depositPayment.amount}€ transferred to detailer`);

    // 10) Envoyer notification au detailer
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
      alreadyReleased: false,
      alreadyTransferred: false, // Transfert manuel créé
      amount: depositPayment.amount,
      transferId: transferResult.id || null,
      message: `Deposit of ${depositPayment.amount}€ released to detailer`,
    };

  } catch (transferError) {
    console.error(`❌ [RELEASE DEPOSIT] Error transferring deposit:`, transferError);
    throw transferError;
  }
}
