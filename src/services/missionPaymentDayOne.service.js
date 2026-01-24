// src/services/missionPaymentDayOne.service.js
import { createSepaPaymentIntent, captureSepaPayment } from "./sepaDirectDebit.service.js";
import { getMissionAgreementById, updateMissionAgreementStripeInfo } from "./missionAgreement.service.js";
import { createMissionPayment, updateMissionPaymentStatus } from "./missionPayment.service.js";
import { autoTransferOnPaymentCapture } from "./missionPayout.service.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * 🟦 CAPTURE DAY ONE PAYMENTS – Capturer les paiements du jour 1
 * 
 * - Commission NIOS (7%) : capturée immédiatement
 * - Acompte detailer (20%) : capturée immédiatement avec transfert automatique
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Object>} Résultat avec les paiements capturés
 */
export async function captureDayOnePayments(missionAgreementId) {
  console.log(`🔄 [DAY ONE PAYMENTS] Starting capture for mission ${missionAgreementId}`);

  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  if (agreement.status !== "active") {
    throw new Error(`Mission Agreement is not active. Current status: ${agreement.status}`);
  }

  // 2) Vérifier que les paiements du jour 1 n'ont pas déjà été capturés
  const { data: existingDayOnePayments, error: existingError } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("mission_agreement_id", missionAgreementId)
    .in("type", ["commission", "deposit"])
    .eq("status", "captured");

  if (existingError) {
    console.error("❌ [DAY ONE PAYMENTS] Error checking existing payments:", existingError);
    throw existingError;
  }

  if (existingDayOnePayments && existingDayOnePayments.length > 0) {
    console.log(`⚠️ [DAY ONE PAYMENTS] Day one payments already captured for mission ${missionAgreementId}`);
    return {
      alreadyCaptured: true,
      commissionCaptured: existingDayOnePayments.find(p => p.type === "commission")?.amount || 0,
      depositCaptured: existingDayOnePayments.find(p => p.type === "deposit")?.amount || 0,
    };
  }

  // 3) Calculer les montants
  const totalAmount = agreement.finalPrice; // 3000€
  const commissionAmount = Math.round(totalAmount * MISSION_COMMISSION_RATE * 100) / 100; // 210€ (7%)
  const depositAmount = agreement.depositAmount || Math.round((totalAmount * 0.20) * 100) / 100; // 600€ (20%)

  console.log(`💰 [DAY ONE PAYMENTS] Total: ${totalAmount}€, Commission: ${commissionAmount}€, Deposit: ${depositAmount}€`);

  // 4) Vérifier le SEPA mandate
  const { getSepaMandate } = await import("./sepaDirectDebit.service.js");
  const sepaMandate = await getSepaMandate(agreement.companyId);

  if (!sepaMandate || sepaMandate.status !== "active") {
    throw new Error("SEPA mandate is not active. Please set up SEPA Direct Debit first.");
  }

  // 5) Vérifier le Stripe Connected Account du detailer
  if (!agreement.stripeConnectedAccountId) {
    throw new Error("Detailer Stripe Connected Account ID not found. Please complete Stripe Connect onboarding first.");
  }

  const results = {
    commissionCaptured: 0,
    depositCaptured: 0,
    totalCaptured: 0,
    commissionPaymentId: null,
    depositPaymentId: null,
  };

  try {
    // 6) Créer et capturer la commission NIOS (210€)
    console.log(`🔄 [DAY ONE PAYMENTS] Creating commission payment (${commissionAmount}€)`);
    
    const commissionPayment = await createMissionPayment({
      missionAgreementId,
      type: "commission",
      amount: commissionAmount,
      scheduledDate: new Date().toISOString(), // Immédiat
    });

    const commissionPaymentIntent = await createSepaPaymentIntent({
      companyUserId: agreement.companyId,
      amount: commissionAmount,
      currency: "eur",
      paymentMethodId: null, // Utilise le payment method par défaut
      applicationFeeAmount: 0, // Pas de commission sur la commission
      captureMethod: "automatic", // Capture immédiate pour la commission
      metadata: {
        missionAgreementId: agreement.id,
        paymentId: commissionPayment.id,
        type: "mission_commission",
        paymentType: "commission",
        userId: agreement.companyId,
      },
    });

    // Mettre à jour le paiement avec le Payment Intent ID
    await updateMissionPaymentStatus(commissionPayment.id, "authorized", {
      stripePaymentIntentId: commissionPaymentIntent.id,
      authorizedAt: new Date().toISOString(),
    });

    // Si capture_method: "automatic", le paiement est déjà capturé
    // Sinon, capturer manuellement
    if (commissionPaymentIntent.status === "succeeded") {
      // Déjà capturé automatiquement
      await updateMissionPaymentStatus(commissionPayment.id, "captured", {
        stripeChargeId: commissionPaymentIntent.id,
        capturedAt: new Date().toISOString(),
      });
    } else {
      // Capturer manuellement si nécessaire
      await captureSepaPayment(commissionPaymentIntent.id);
      await updateMissionPaymentStatus(commissionPayment.id, "captured", {
        stripeChargeId: commissionPaymentIntent.id,
        capturedAt: new Date().toISOString(),
      });
    }

    results.commissionCaptured = commissionAmount;
    results.commissionPaymentId = commissionPayment.id;

    console.log(`✅ [DAY ONE PAYMENTS] Commission captured: ${commissionAmount}€`);

    // 7) Créer et capturer l'acompte detailer (600€)
    console.log(`🔄 [DAY ONE PAYMENTS] Creating deposit payment (${depositAmount}€)`);

    const depositPayment = await createMissionPayment({
      missionAgreementId,
      type: "deposit",
      amount: depositAmount,
      scheduledDate: new Date().toISOString(), // Immédiat
    });

    // Pour l'acompte, utiliser Stripe Connect pour transférer directement au detailer
    // Pas de commission supplémentaire (déjà capturée séparément)
    const depositPaymentIntent = await createSepaPaymentIntent({
      companyUserId: agreement.companyId,
      amount: depositAmount,
      currency: "eur",
      paymentMethodId: null,
      applicationFeeAmount: 0, // Pas de commission sur l'acompte (déjà capturée)
      captureMethod: "automatic", // Capture immédiate pour l'acompte
      metadata: {
        missionAgreementId: agreement.id,
        paymentId: depositPayment.id,
        type: "mission_deposit",
        paymentType: "deposit",
        userId: agreement.companyId,
        stripeConnectedAccountId: agreement.stripeConnectedAccountId, // ✅ Requis pour Stripe Connect
      },
    });

    // Mettre à jour le paiement avec le Payment Intent ID
    await updateMissionPaymentStatus(depositPayment.id, "authorized", {
      stripePaymentIntentId: depositPaymentIntent.id,
      authorizedAt: new Date().toISOString(),
    });

    // Si capture_method: "automatic", le paiement est déjà capturé
    // Sinon, capturer manuellement
    if (depositPaymentIntent.status === "succeeded") {
      // Déjà capturé automatiquement
      await updateMissionPaymentStatus(depositPayment.id, "captured", {
        stripeChargeId: depositPaymentIntent.id,
        capturedAt: new Date().toISOString(),
      });
    } else {
      // Capturer manuellement si nécessaire
      await captureSepaPayment(depositPaymentIntent.id);
      await updateMissionPaymentStatus(depositPayment.id, "captured", {
        stripeChargeId: depositPaymentIntent.id,
        capturedAt: new Date().toISOString(),
      });
    }

    // ✅ Le transfert vers le detailer est automatique via Stripe Connect
    // Le PaymentIntent a été créé avec `on_behalf_of` et `transfer_data`
    // Le montant complet de l'acompte (600€) est automatiquement transféré au detailer
    console.log(`✅ [DAY ONE PAYMENTS] Deposit will be automatically transferred to detailer via Stripe Connect: ${depositAmount}€`);

    results.depositCaptured = depositAmount;
    results.depositPaymentId = depositPayment.id;
    results.totalCaptured = commissionAmount + depositAmount; // 810€

    console.log(`✅ [DAY ONE PAYMENTS] Deposit captured: ${depositAmount}€`);
    console.log(`✅ [DAY ONE PAYMENTS] Total captured: ${results.totalCaptured}€`);

    // 8) Envoyer des notifications
    try {
      const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
      
      // Notification à la company
      await sendNotificationWithDeepLink({
        userId: agreement.companyId,
        title: "Paiements du jour 1 capturés",
        message: `Les paiements du jour 1 (${results.totalCaptured}€) pour "${agreement.title || 'votre mission'}" ont été capturés automatiquement`,
        type: "mission_payment_received",
        id: missionAgreementId,
      });

      // Notification au detailer
      await sendNotificationWithDeepLink({
        userId: agreement.detailerId,
        title: "Acompte reçu",
        message: `Votre acompte de ${depositAmount}€ pour "${agreement.title || 'la mission'}" a été reçu`,
        type: "mission_payment_received",
        id: missionAgreementId,
      });
    } catch (notifError) {
      console.error(`⚠️ [DAY ONE PAYMENTS] Notification send failed:`, notifError);
    }

    return results;

  } catch (error) {
    console.error(`❌ [DAY ONE PAYMENTS] Error capturing day one payments:`, error);
    throw error;
  }
}
