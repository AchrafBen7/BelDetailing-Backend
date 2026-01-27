// src/services/missionPaymentDayOne.service.js
import { createSepaPaymentIntent, captureSepaPayment } from "./sepaDirectDebit.service.js";
import { getMissionAgreementById, updateMissionAgreementStripeInfo } from "./missionAgreement.service.js";
import { createMissionPayment, updateMissionPaymentStatus } from "./missionPayment.service.js";
import { autoTransferOnPaymentCapture } from "./missionPayout.service.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * 🟦 CREATE DAY ONE PAYMENTS – Créer et autoriser les paiements du jour 1 (Jour 0 = activation)
 * 
 * - Commission NIOS (7%) : PaymentIntent créé avec capture_method: "manual"
 * - Acompte detailer (20%) : PaymentIntent créé avec capture_method: "manual"
 * 
 * Ces paiements seront capturés automatiquement au Jour 1 via captureDayOnePayments()
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Object>} Résultat avec les PaymentIntents créés
 */
export async function createDayOnePayments(missionAgreementId) {
  console.log(`🔄 [DAY ONE PAYMENTS] Creating payment intents for mission ${missionAgreementId} (Jour 0 activation)`);

  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  // ✅ Accepter aussi agreement_fully_confirmed (on va créer les paiements et passer à active)
  if (agreement.status !== "active" && agreement.status !== "agreement_fully_confirmed") {
    throw new Error(`Mission Agreement is not in a valid status. Current status: ${agreement.status}`);
  }

  // 2) Vérifier que les paiements du jour 1 n'ont pas déjà été créés
  const { data: existingDayOnePayments, error: existingError } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("mission_agreement_id", missionAgreementId)
    .in("type", ["commission", "deposit"]);

  if (existingError) {
    console.error("❌ [DAY ONE PAYMENTS] Error checking existing payments:", existingError);
    throw existingError;
  }

  if (existingDayOnePayments && existingDayOnePayments.length > 0) {
    console.log(`⚠️ [DAY ONE PAYMENTS] Day one payments already created for mission ${missionAgreementId}`);
    return {
      alreadyCreated: true,
      commissionPaymentId: existingDayOnePayments.find(p => p.type === "commission")?.id || null,
      depositPaymentId: existingDayOnePayments.find(p => p.type === "deposit")?.id || null,
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
    commissionPaymentId: null,
    depositPaymentId: null,
    commissionPaymentIntentId: null,
    depositPaymentIntentId: null,
  };

  try {
    // 6) Créer la commission NIOS (210€) - PaymentIntent avec capture_method: "manual"
    console.log(`🔄 [DAY ONE PAYMENTS] Creating commission payment intent (${commissionAmount}€)`);
    
    const commissionPayment = await createMissionPayment({
      missionAgreementId,
      type: "commission",
      amount: commissionAmount,
      scheduledDate: new Date(agreement.startDate).toISOString(), // Jour 1 (startDate)
    });

    // ✅ Pour SEPA, on crée avec confirm: true (automatique dans createSepaPaymentIntent)
    // Le PaymentIntent sera en "processing" puis "succeeded" via webhook (2-5 jours)
    const commissionPaymentIntent = await createSepaPaymentIntent({
      companyUserId: agreement.companyId,
      amount: commissionAmount,
      currency: "eur",
      paymentMethodId: null, // Utilise le payment method par défaut
      applicationFeeAmount: 0, // Pas de commission sur la commission
      captureMethod: "automatic", // ✅ SEPA est automatique et asynchrone
      metadata: {
        missionAgreementId: agreement.id,
        paymentId: commissionPayment.id,
        type: "mission_commission",
        paymentType: "commission",
        userId: agreement.companyId,
      },
    });

    // ✅ Pour SEPA, le PaymentIntent est créé avec confirm: true, donc il est en "processing"
    // Le statut sera mis à jour à "succeeded" via webhook (2-5 jours)
    // On met le statut à "processing" immédiatement
    const commissionStatus = commissionPaymentIntent.status === "succeeded" ? "captured" : 
                            commissionPaymentIntent.status === "processing" ? "processing" : "authorized";
    
    await updateMissionPaymentStatus(commissionPayment.id, commissionStatus, {
      stripePaymentIntentId: commissionPaymentIntent.id,
      authorizedAt: commissionStatus === "authorized" ? new Date().toISOString() : null,
    });

    results.commissionPaymentId = commissionPayment.id;
    results.commissionPaymentIntentId = commissionPaymentIntent.id;

    console.log(`✅ [DAY ONE PAYMENTS] Commission payment intent created: ${commissionPaymentIntent.id} (status: ${commissionPaymentIntent.status})`);

    // 7) Créer l'acompte detailer (600€) - PaymentIntent avec capture_method: "manual"
    console.log(`🔄 [DAY ONE PAYMENTS] Creating deposit payment intent (${depositAmount}€)`);

    const depositPayment = await createMissionPayment({
      missionAgreementId,
      type: "deposit",
      amount: depositAmount,
      scheduledDate: new Date(agreement.startDate).toISOString(), // Jour 1 (startDate)
    });

    // Pour l'acompte, utiliser Stripe Connect pour transférer directement au detailer
    // Pas de commission supplémentaire (déjà capturée séparément)
    // ✅ Pour SEPA, on crée avec confirm: true (automatique dans createSepaPaymentIntent)
    const depositPaymentIntent = await createSepaPaymentIntent({
      companyUserId: agreement.companyId,
      amount: depositAmount,
      currency: "eur",
      paymentMethodId: null,
      applicationFeeAmount: 0, // Pas de commission sur l'acompte (déjà capturée)
      captureMethod: "automatic", // ✅ SEPA est automatique et asynchrone
      metadata: {
        missionAgreementId: agreement.id,
        paymentId: depositPayment.id,
        type: "mission_deposit",
        paymentType: "deposit",
        userId: agreement.companyId,
        stripeConnectedAccountId: agreement.stripeConnectedAccountId, // ✅ Requis pour Stripe Connect
      },
    });

    // ✅ Pour SEPA, le PaymentIntent est créé avec confirm: true, donc il est en "processing"
    // Le statut sera mis à jour à "succeeded" via webhook (2-5 jours)
    // On met le statut à "processing" immédiatement
    const depositStatus = depositPaymentIntent.status === "succeeded" ? "captured" : 
                         depositPaymentIntent.status === "processing" ? "processing" : "authorized";
    
    await updateMissionPaymentStatus(depositPayment.id, depositStatus, {
      stripePaymentIntentId: depositPaymentIntent.id,
      authorizedAt: depositStatus === "authorized" ? new Date().toISOString() : null,
    });

    results.depositPaymentId = depositPayment.id;
    results.depositPaymentIntentId = depositPaymentIntent.id;

    console.log(`✅ [DAY ONE PAYMENTS] Deposit payment intent created: ${depositPaymentIntent.id} (status: ${depositPaymentIntent.status})`);
    console.log(`✅ [DAY ONE PAYMENTS] Day one payments created and confirmed successfully (SEPA processing - will be succeeded via webhook)`);

    return results;

  } catch (error) {
    console.error(`❌ [DAY ONE PAYMENTS] Error creating day one payments:`, error);
    
    // ✅ Améliorer le message d'erreur pour les erreurs Stripe
    if (error.type === "StripeInvalidRequestError" || error.statusCode === 402) {
      const stripeError = error.raw?.message || error.message;
      
      // Si c'est une erreur "too high-risk" ou similaire
      if (stripeError.includes("unexpected error") || error.statusCode === 402) {
        throw new Error(
          `SEPA payment was blocked by Stripe (likely due to risk assessment). ` +
          `This can happen with high amounts or first-time SEPA payments. ` +
          `Please try with a smaller amount or contact support. ` +
          `Error: ${stripeError}`
        );
      }
      
      throw new Error(`Stripe payment error: ${stripeError}`);
    }
    
    throw error;
  }
}

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
  console.log(`🔄 [DAY ONE PAYMENTS] Starting capture for mission ${missionAgreementId} (Jour 1)`);

  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  // ✅ Accepter aussi agreement_fully_confirmed (on va capturer les paiements et passer à active)
  if (agreement.status !== "active" && agreement.status !== "agreement_fully_confirmed") {
    throw new Error(`Mission Agreement is not in a valid status. Current status: ${agreement.status}`);
  }

  // 2) Récupérer les paiements du jour 1 (commission + deposit) qui sont en statut "authorized" ou "processing"
  // ✅ Pour SEPA, les paiements peuvent être en "processing" (créés avec confirm: true)
  const { data: dayOnePayments, error: fetchError } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("mission_agreement_id", missionAgreementId)
    .in("type", ["commission", "deposit"])
    .in("status", ["authorized", "processing"]); // ✅ Accepter aussi "processing" pour SEPA

  if (fetchError) {
    console.error("❌ [DAY ONE PAYMENTS] Error fetching day one payments:", fetchError);
    throw fetchError;
  }

  if (!dayOnePayments || dayOnePayments.length === 0) {
    throw new Error("Day one payments not found. Please create them first using createDayOnePayments().");
  }

  // 3) Vérifier que les paiements n'ont pas déjà été capturés
  const { data: capturedPayments, error: capturedError } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("mission_agreement_id", missionAgreementId)
    .in("type", ["commission", "deposit"])
    .eq("status", "captured");

  if (capturedError) {
    console.error("❌ [DAY ONE PAYMENTS] Error checking captured payments:", capturedError);
    throw capturedError;
  }

  if (capturedPayments && capturedPayments.length > 0) {
    console.log(`⚠️ [DAY ONE PAYMENTS] Day one payments already captured for mission ${missionAgreementId}`);
    return {
      alreadyCaptured: true,
      commissionCaptured: capturedPayments.find(p => p.type === "commission")?.amount || 0,
      depositCaptured: capturedPayments.find(p => p.type === "deposit")?.amount || 0,
    };
  }

  const commissionPayment = dayOnePayments.find(p => p.type === "commission");
  const depositPayment = dayOnePayments.find(p => p.type === "deposit");

  if (!commissionPayment || !depositPayment) {
    throw new Error("Missing commission or deposit payment. Please create them first using createDayOnePayments().");
  }

  const results = {
    commissionCaptured: 0,
    depositCaptured: 0,
    totalCaptured: 0,
    commissionPaymentId: commissionPayment.id,
    depositPaymentId: depositPayment.id,
  };

  try {
    // 4) Capturer la commission NIOS (210€)
    console.log(`🔄 [DAY ONE PAYMENTS] Capturing commission payment (${commissionPayment.amount}€)`);
    
    if (!commissionPayment.stripe_payment_intent_id) {
      throw new Error("Commission payment missing PaymentIntent ID");
    }

    // ✅ Pour SEPA, vérifier le statut du PaymentIntent
    // SEPA est asynchrone : processing → succeeded (via webhook)
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-11-17.clover",
    });

    const commissionPI = await stripe.paymentIntents.retrieve(commissionPayment.stripe_payment_intent_id);
    
    if (commissionPI.status === "succeeded") {
      // ✅ Déjà succeeded (via webhook ou confirmation immédiate)
      await updateMissionPaymentStatus(commissionPayment.id, "captured", {
        stripeChargeId: commissionPI.latest_charge || commissionPI.id,
        capturedAt: new Date().toISOString(),
      });
      console.log(`✅ [DAY ONE PAYMENTS] Commission already succeeded: ${commissionPayment.amount}€`);
    } else if (commissionPI.status === "processing") {
      // ✅ SEPA en cours de traitement (normal pour SEPA - 2-5 jours)
      await updateMissionPaymentStatus(commissionPayment.id, "processing", {
        stripePaymentIntentId: commissionPI.id,
      });
      console.log(`⏳ [DAY ONE PAYMENTS] Commission payment processing (SEPA - will be succeeded via webhook): ${commissionPayment.amount}€`);
    } else if (commissionPI.status === "requires_capture") {
      // Capturer maintenant (si possible)
      await captureSepaPayment(commissionPayment.stripe_payment_intent_id);
      await updateMissionPaymentStatus(commissionPayment.id, "captured", {
        stripeChargeId: commissionPayment.stripe_payment_intent_id,
        capturedAt: new Date().toISOString(),
      });
      console.log(`✅ [DAY ONE PAYMENTS] Commission captured: ${commissionPayment.amount}€`);
    } else {
      // Autres statuts : on met à jour le statut du paiement pour refléter le statut Stripe
      await updateMissionPaymentStatus(commissionPayment.id, "processing", {
        stripePaymentIntentId: commissionPI.id,
      });
      console.log(`⏳ [DAY ONE PAYMENTS] Commission payment in status: ${commissionPI.status} - will be updated via webhook`);
    }

    // ✅ Ne compter que si réellement capturé (succeeded)
    if (commissionPI.status === "succeeded") {
      results.commissionCaptured = commissionPayment.amount;
    } else {
      results.commissionCaptured = 0; // En processing, pas encore capturé
    }

    // 5) Capturer l'acompte detailer (600€)
    console.log(`🔄 [DAY ONE PAYMENTS] Capturing deposit payment (${depositPayment.amount}€)`);

    if (!depositPayment.stripe_payment_intent_id) {
      throw new Error("Deposit payment missing PaymentIntent ID");
    }

    const depositPI = await stripe.paymentIntents.retrieve(depositPayment.stripe_payment_intent_id);
    
    if (depositPI.status === "succeeded") {
      // ✅ Déjà succeeded (via webhook ou confirmation immédiate)
      await updateMissionPaymentStatus(depositPayment.id, "captured", {
        stripeChargeId: depositPI.latest_charge || depositPI.id,
        capturedAt: new Date().toISOString(),
      });
      console.log(`✅ [DAY ONE PAYMENTS] Deposit already succeeded: ${depositPayment.amount}€`);
    } else if (depositPI.status === "processing") {
      // ✅ SEPA en cours de traitement (normal pour SEPA - 2-5 jours)
      await updateMissionPaymentStatus(depositPayment.id, "processing", {
        stripePaymentIntentId: depositPI.id,
      });
      console.log(`⏳ [DAY ONE PAYMENTS] Deposit payment processing (SEPA - will be succeeded via webhook): ${depositPayment.amount}€`);
    } else if (depositPI.status === "requires_capture") {
      // Capturer maintenant (si possible)
      await captureSepaPayment(depositPayment.stripe_payment_intent_id);
      await updateMissionPaymentStatus(depositPayment.id, "captured", {
        stripeChargeId: depositPayment.stripe_payment_intent_id,
        capturedAt: new Date().toISOString(),
      });
      console.log(`✅ [DAY ONE PAYMENTS] Deposit captured: ${depositPayment.amount}€`);
    } else {
      // Autres statuts : on met à jour le statut du paiement pour refléter le statut Stripe
      await updateMissionPaymentStatus(depositPayment.id, "processing", {
        stripePaymentIntentId: depositPI.id,
      });
      console.log(`⏳ [DAY ONE PAYMENTS] Deposit payment in status: ${depositPI.status} - will be updated via webhook`);
    }

    // ✅ Le transfert vers le detailer est automatique via Stripe Connect
    // Le PaymentIntent a été créé avec `on_behalf_of` et `transfer_data`
    // Le montant complet de l'acompte (600€) est automatiquement transféré au detailer
    console.log(`✅ [DAY ONE PAYMENTS] Deposit will be automatically transferred to detailer via Stripe Connect: ${depositPayment.amount}€`);

    // ✅ Ne compter que si réellement capturé (succeeded)
    if (depositPI.status === "succeeded") {
      results.depositCaptured = depositPayment.amount;
    } else {
      results.depositCaptured = 0; // En processing, pas encore capturé
    }
    
    results.totalCaptured = results.commissionCaptured + results.depositCaptured;

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
