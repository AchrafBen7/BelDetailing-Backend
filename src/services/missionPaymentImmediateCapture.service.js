// src/services/missionPaymentImmediateCapture.service.js
/**
 * 🟦 IMMEDIATE CAPTURE ON ACCEPTANCE – Débit automatique immédiat (T0)
 * 
 * Lorsque le detailer accepte le contrat:
 * 1. Commission NIOS (7%) : Capturée immédiatement et envoyée à NIOS
 * 2. Acompte detailer (20%) : Capturé immédiatement mais "hold" jusqu'à J+1
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Object>} Résultat avec les paiements capturés
 */
import { createSepaPaymentIntent, captureSepaPayment } from "./sepaDirectDebit.service.js";
import { getMissionAgreementById, updateMissionAgreementStripeInfo } from "./missionAgreement.service.js";
import { createMissionPayment, updateMissionPaymentStatus } from "./missionPayment.service.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

export async function captureImmediatePaymentsOnAcceptance(missionAgreementId) {
  console.log(`🔄 [IMMEDIATE CAPTURE] Starting immediate capture for mission ${missionAgreementId} (T0 - Detailer acceptance)`);

  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  if (agreement.status !== "active") {
    throw new Error(`Mission Agreement is not active. Current status: ${agreement.status}`);
  }

  // 2) Vérifier que les paiements immédiats n'ont pas déjà été créés
  const { data: existingPayments, error: existingError } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("mission_agreement_id", missionAgreementId)
    .in("type", ["commission", "deposit"]);

  if (existingError) {
    console.error("❌ [IMMEDIATE CAPTURE] Error checking existing payments:", existingError);
    throw existingError;
  }

  if (existingPayments && existingPayments.length > 0) {
    console.log(`⚠️ [IMMEDIATE CAPTURE] Payments already created for mission ${missionAgreementId}`);
    // Vérifier si déjà capturés
    const commissionPayment = existingPayments.find(p => p.type === "commission");
    const depositPayment = existingPayments.find(p => p.type === "deposit");
    
    if (commissionPayment?.status === "captured" && depositPayment?.status === "captured") {
      return {
        alreadyCaptured: true,
        commissionCaptured: commissionPayment.amount,
        depositCaptured: depositPayment.amount,
        totalCaptured: commissionPayment.amount + depositPayment.amount,
      };
    }
  }

  // 3) Calculer les montants
  const totalAmount = agreement.finalPrice; // 3000€
  const commissionAmount = Math.round(totalAmount * MISSION_COMMISSION_RATE * 100) / 100; // 210€ (7%)
  const depositAmount = agreement.depositAmount || Math.round((totalAmount * 0.20) * 100) / 100; // 600€ (20%)

  console.log(`💰 [IMMEDIATE CAPTURE] Total: ${totalAmount}€, Commission: ${commissionAmount}€, Deposit: ${depositAmount}€`);

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
    commissionPaymentIntentId: null,
    depositPaymentIntentId: null,
  };

  try {
    // 6) Créer et capturer IMMÉDIATEMENT la commission NIOS (210€)
    console.log(`🔄 [IMMEDIATE CAPTURE] Creating and capturing commission payment (${commissionAmount}€) IMMEDIATELY`);
    
    // 6.1) Créer le paiement dans la DB
    const commissionPayment = await createMissionPayment({
      missionAgreementId,
      type: "commission",
      amount: commissionAmount,
      scheduledDate: new Date().toISOString(), // T0 (maintenant)
    });

    // 6.2) Créer le PaymentIntent avec capture automatique
    const commissionPaymentIntent = await createSepaPaymentIntent({
      companyUserId: agreement.companyId,
      amount: commissionAmount,
      currency: "eur",
      paymentMethodId: null, // Utilise le payment method par défaut (SEPA mandate)
      applicationFeeAmount: 0, // Pas de commission sur la commission
      captureMethod: "automatic", // ✅ Capture automatique immédiate
      metadata: {
        missionAgreementId: agreement.id,
        paymentId: commissionPayment.id,
        type: "mission_commission_immediate",
        paymentType: "commission",
        userId: agreement.companyId,
        capturedAt: "T0", // T0 = immédiatement
      },
    });

    // 6.3) Capturer immédiatement (si pas déjà capturé automatiquement)
    let commissionPI = await stripe.paymentIntents.retrieve(commissionPaymentIntent.id);
    if (commissionPI.status === "requires_capture") {
      await captureSepaPayment(commissionPaymentIntent.id);
      commissionPI = await stripe.paymentIntents.retrieve(commissionPaymentIntent.id);
    }

    // 6.4) Mettre à jour le paiement avec le statut "captured"
    await updateMissionPaymentStatus(commissionPayment.id, "captured", {
      stripePaymentIntentId: commissionPaymentIntent.id,
      stripeChargeId: commissionPI.latest_charge || commissionPaymentIntent.id,
      capturedAt: new Date().toISOString(),
    });

    results.commissionPaymentId = commissionPayment.id;
    results.commissionPaymentIntentId = commissionPaymentIntent.id;
    results.commissionCaptured = commissionAmount;

    console.log(`✅ [IMMEDIATE CAPTURE] Commission captured IMMEDIATELY: ${commissionAmount}€ (PaymentIntent: ${commissionPaymentIntent.id})`);

    // 7) Créer et capturer IMMÉDIATEMENT l'acompte detailer (600€) - mais en "hold" jusqu'à J+1
    console.log(`🔄 [IMMEDIATE CAPTURE] Creating and capturing deposit payment (${depositAmount}€) IMMEDIATELY (will be held until J+1)`);
    
    // 7.1) Créer le paiement dans la DB
    const depositPayment = await createMissionPayment({
      missionAgreementId,
      type: "deposit",
      amount: depositAmount,
      scheduledDate: new Date(agreement.startDate).toISOString(), // Jour 1 (startDate)
    });

    // 7.2) Créer le PaymentIntent avec capture automatique
    // Pour l'acompte, on capture immédiatement MAIS on ne transfère PAS encore au detailer
    // Le transfert sera fait à J+1 via un Transfer séparé
    // ⚠️ IMPORTANT: Ne pas mettre stripeConnectedAccountId dans metadata pour éviter le transfert automatique
    const depositPaymentIntent = await createSepaPaymentIntent({
      companyUserId: agreement.companyId,
      amount: depositAmount,
      currency: "eur",
      paymentMethodId: null,
      applicationFeeAmount: 0, // Pas de commission sur l'acompte (déjà capturée)
      captureMethod: "automatic", // ✅ Capture automatique immédiate
      metadata: {
        missionAgreementId: agreement.id,
        paymentId: depositPayment.id,
        type: "mission_deposit_immediate",
        paymentType: "deposit",
        userId: agreement.companyId,
        // ⚠️ NE PAS mettre stripeConnectedAccountId ici pour éviter le transfert automatique
        // Le transfert sera fait à J+1 via missionPayout.service.js
        holdUntil: "J+1", // ✅ Indique que le transfert sera fait à J+1
        capturedAt: "T0", // T0 = immédiatement
        requiresTransferAtJPlusOne: "true", // Flag pour indiquer qu'un transfert est nécessaire à J+1
      },
    });

    // 7.3) Capturer immédiatement (si pas déjà capturé automatiquement)
    let depositPI = await stripe.paymentIntents.retrieve(depositPaymentIntent.id);
    if (depositPI.status === "requires_capture") {
      await captureSepaPayment(depositPaymentIntent.id);
      depositPI = await stripe.paymentIntents.retrieve(depositPaymentIntent.id);
    }

    // 7.4) Mettre à jour le paiement avec le statut "captured_held"
    // Ce statut indique que l'argent est capturé mais le transfert au detailer sera fait à J+1
    await updateMissionPaymentStatus(depositPayment.id, "captured_held", {
      stripePaymentIntentId: depositPaymentIntent.id,
      stripeChargeId: depositPI.latest_charge || depositPaymentIntent.id,
      capturedAt: new Date().toISOString(),
      holdUntil: new Date(new Date(agreement.startDate).getTime() + 24 * 60 * 60 * 1000).toISOString(), // J+1
    });

    results.depositPaymentId = depositPayment.id;
    results.depositPaymentIntentId = depositPaymentIntent.id;
    results.depositCaptured = depositAmount;
    results.totalCaptured = commissionAmount + depositAmount;

    console.log(`✅ [IMMEDIATE CAPTURE] Deposit captured IMMEDIATELY: ${depositAmount}€ (PaymentIntent: ${depositPaymentIntent.id})`);
    console.log(`✅ [IMMEDIATE CAPTURE] Deposit will be transferred to detailer at J+1 (${new Date(new Date(agreement.startDate).getTime() + 24 * 60 * 60 * 1000).toISOString()})`);
    console.log(`✅ [IMMEDIATE CAPTURE] Total captured IMMEDIATELY: ${results.totalCaptured}€`);

    return results;

  } catch (error) {
    console.error(`❌ [IMMEDIATE CAPTURE] Error capturing immediate payments:`, error);
    throw error;
  }
}
