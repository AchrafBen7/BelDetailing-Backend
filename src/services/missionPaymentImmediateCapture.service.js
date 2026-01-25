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
    console.error(`❌ [IMMEDIATE CAPTURE] Mission Agreement not found: ${missionAgreementId}`);
    throw new Error("Mission Agreement not found");
  }

  console.log(`ℹ️ [IMMEDIATE CAPTURE] Agreement status: ${agreement.status}, finalPrice: ${agreement.finalPrice}€, stripeConnectedAccountId: ${agreement.stripeConnectedAccountId}`);

  if (agreement.status !== "active") {
    console.error(`❌ [IMMEDIATE CAPTURE] Mission Agreement is not active. Current status: ${agreement.status}`);
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
    // 6) Créer les paiements dans la DB (commission et acompte)
    console.log(`🔄 [IMMEDIATE CAPTURE] Creating commission and deposit payments in DB`);
    
    const commissionPayment = await createMissionPayment({
      missionAgreementId,
      type: "commission",
      amount: commissionAmount,
      scheduledDate: new Date().toISOString(), // T0 (maintenant)
    });

    const depositPayment = await createMissionPayment({
      missionAgreementId,
      type: "deposit",
      amount: depositAmount,
      scheduledDate: new Date(agreement.startDate).toISOString(), // Jour 1 (startDate)
    });

    // 7) ✅ FIX SEPA : Créer DEUX PaymentIntents séparés (commission + acompte)
    // ⚠️ IMPORTANT : Avec SEPA Direct Debit, on ne peut PAS utiliser transfer_data + application_fee_amount
    // ensemble car cela cause une erreur Stripe "unexpected error"
    // 
    // Solution : Séparer la charge et le transfert
    // 1. Créer les PaymentIntents sur la plateforme (sans transfer_data, sans application_fee_amount)
    // 2. Attendre que les paiements soient succeeded
    // 3. Créer des Transfers séparés vers le Connected Account pour l'acompte
    // 4. La commission reste sur la plateforme (NIOS)
    
    console.log(`🔄 [IMMEDIATE CAPTURE] Creating TWO separate PaymentIntents (SEPA fix):`);
    console.log(`   - Commission: ${commissionAmount}€ (stays on platform)`);
    console.log(`   - Deposit: ${depositAmount}€ (will be transferred via Transfer after succeeded)`);
    
    // 7.1) Créer le PaymentIntent pour la COMMISSION (sur la plateforme, sans transfer)
    const commissionPaymentIntent = await createSepaPaymentIntent({
      companyUserId: agreement.companyId,
      amount: commissionAmount,
      currency: "eur",
      paymentMethodId: null, // Utilise le payment method par défaut (SEPA mandate)
      applicationFeeAmount: null, // ✅ Pas de application_fee_amount avec SEPA
      captureMethod: "automatic", // ✅ Capture automatique immédiate
      metadata: {
        missionAgreementId: agreement.id,
        commissionPaymentId: commissionPayment.id,
        type: "mission_immediate_capture",
        paymentType: "commission",
        userId: agreement.companyId,
        commissionAmount: commissionAmount.toString(),
        capturedAt: "T0", // T0 = immédiatement
      },
    });
    
    // 7.2) Créer le PaymentIntent pour l'ACOMPTE (sur la plateforme, sans transfer)
    const depositPaymentIntent = await createSepaPaymentIntent({
      companyUserId: agreement.companyId,
      amount: depositAmount,
      currency: "eur",
      paymentMethodId: null, // Utilise le payment method par défaut (SEPA mandate)
      applicationFeeAmount: null, // ✅ Pas de application_fee_amount avec SEPA
      captureMethod: "automatic", // ✅ Capture automatique immédiate
      metadata: {
        missionAgreementId: agreement.id,
        depositPaymentId: depositPayment.id,
        type: "mission_immediate_capture",
        paymentType: "deposit",
        userId: agreement.companyId,
        depositAmount: depositAmount.toString(),
        stripeConnectedAccountId: agreement.stripeConnectedAccountId, // ✅ Pour le Transfer ultérieur
        holdUntil: "J+1", // ✅ Indique que l'acompte ne doit pas être retiré avant J+1
        capturedAt: "T0", // T0 = immédiatement
        note: "Deposit will be transferred to detailer via Transfer after payment succeeded", // Note pour documentation
      },
    });

    // 7.3) Vérifier que les PaymentIntents sont bien créés et confirmés
    let commissionPI = await stripe.paymentIntents.retrieve(commissionPaymentIntent.id);
    let depositPI = await stripe.paymentIntents.retrieve(depositPaymentIntent.id);
    
    console.log(`✅ [IMMEDIATE CAPTURE] Commission PaymentIntent created: ${commissionPI.id}, status: ${commissionPI.status}`);
    console.log(`✅ [IMMEDIATE CAPTURE] Deposit PaymentIntent created: ${depositPI.id}, status: ${depositPI.status}`);
    
    // 7.4) Si les PaymentIntents sont en requires_capture, les capturer
    if (commissionPI.status === "requires_capture") {
      await captureSepaPayment(commissionPaymentIntent.id);
      commissionPI = await stripe.paymentIntents.retrieve(commissionPaymentIntent.id);
    }
    
    if (depositPI.status === "requires_capture") {
      await captureSepaPayment(depositPaymentIntent.id);
      depositPI = await stripe.paymentIntents.retrieve(depositPaymentIntent.id);
    }

    // 7.5) Mettre à jour les paiements avec les statuts
    // Commission : "captured" (collectée immédiatement sur la plateforme)
    await updateMissionPaymentStatus(commissionPayment.id, "captured", {
      stripePaymentIntentId: commissionPaymentIntent.id,
      stripeChargeId: commissionPI.latest_charge || commissionPaymentIntent.id,
      capturedAt: new Date().toISOString(),
    });

    // Acompte : "captured_held" (capturé sur la plateforme, sera transféré via Transfer après succeeded)
    await updateMissionPaymentStatus(depositPayment.id, "captured_held", {
      stripePaymentIntentId: depositPaymentIntent.id,
      stripeChargeId: depositPI.latest_charge || depositPaymentIntent.id,
      capturedAt: new Date().toISOString(),
      holdUntil: new Date(new Date(agreement.startDate).getTime() + 24 * 60 * 60 * 1000).toISOString(), // J+1
      // Note: Le Transfer sera créé automatiquement via webhook payment_intent.succeeded
      // ou via le cron job releaseDepositsAtJPlusOne si le paiement est déjà succeeded
    });
    
    // 7.6) ✅ Si le paiement de l'acompte est déjà succeeded, créer le Transfer immédiatement
    if (depositPI.status === "succeeded" && depositPI.latest_charge) {
      console.log(`🔄 [IMMEDIATE CAPTURE] Deposit payment already succeeded, creating Transfer to detailer...`);
      try {
        const { createTransferToDetailer } = await import("./missionPayout.service.js");
        const transferResult = await createTransferToDetailer({
          missionAgreementId: agreement.id,
          paymentId: depositPayment.id,
          amount: depositAmount,
          commissionRate: 0, // ✅ Pas de commission sur l'acompte (déjà capturée séparément)
        });
        
        console.log(`✅ [IMMEDIATE CAPTURE] Deposit transferred to detailer: ${transferResult.id}, amount: ${transferResult.amount}€`);
        
        // Mettre à jour le statut du paiement à "transferred"
        await updateMissionPaymentStatus(depositPayment.id, "transferred", {
          transferredAt: new Date().toISOString(),
          stripeTransferId: transferResult.id,
        });
      } catch (transferError) {
        console.error(`⚠️ [IMMEDIATE CAPTURE] Error creating transfer (will be retried via webhook/cron):`, transferError);
        // Ne pas faire échouer, le Transfer sera créé via webhook ou cron job
      }
    } else {
      console.log(`ℹ️ [IMMEDIATE CAPTURE] Deposit payment status: ${depositPI.status}, Transfer will be created via webhook payment_intent.succeeded or cron job`);
    }

    results.commissionPaymentId = commissionPayment.id;
    results.depositPaymentId = depositPayment.id;
    results.commissionPaymentIntentId = commissionPaymentIntent.id;
    results.depositPaymentIntentId = depositPaymentIntent.id; // ✅ Deux PaymentIntents séparés
    results.commissionCaptured = commissionAmount;
    results.depositCaptured = depositAmount;
    results.totalCaptured = commissionAmount + depositAmount;

    console.log(`✅ [IMMEDIATE CAPTURE] Commission captured IMMEDIATELY on platform: ${commissionAmount}€ (PaymentIntent: ${commissionPaymentIntent.id})`);
    console.log(`✅ [IMMEDIATE CAPTURE] Deposit captured IMMEDIATELY on platform: ${depositAmount}€ (PaymentIntent: ${depositPaymentIntent.id})`);
    console.log(`✅ [IMMEDIATE CAPTURE] Total captured IMMEDIATELY: ${results.totalCaptured}€`);
    console.log(`ℹ️ [IMMEDIATE CAPTURE] Deposit will be transferred to detailer Connected Account via Transfer after payment succeeded`);
    console.log(`⚠️ [IMMEDIATE CAPTURE] NOTE: Deposit should not be withdrawn before J+1 (${new Date(new Date(agreement.startDate).getTime() + 24 * 60 * 60 * 1000).toISOString()})`);

    return results;

  } catch (error) {
    console.error(`❌ [IMMEDIATE CAPTURE] Error capturing immediate payments:`, error);
    throw error;
  }
}
