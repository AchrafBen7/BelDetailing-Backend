// src/services/missionPaymentImmediateCapture.service.js
/**
 * 🟦 CREATE SEPA PAYMENT ORDERS ON ACCEPTANCE – Créer les ordres de prélèvement SEPA (T0)
 * 
 * ⚠️ IMPORTANT : SEPA est ASYNCHRONE, pas synchrone comme les cartes bancaires
 * 
 * Lorsque le detailer accepte le contrat:
 * 1. Commission NIOS (7%) : Ordre de prélèvement créé (statut: processing → succeeded via webhook)
 * 2. Acompte detailer (20%) : Ordre de prélèvement créé (statut: processing → succeeded via webhook)
 * 
 * Flow SEPA :
 * - T0 : PaymentIntent créé avec confirm: true → statut = "processing" (NORMAL pour SEPA)
 * - Webhook processing : Prélèvement envoyé à la banque (statut DB = "processing")
 * - Webhook succeeded : Argent reçu (2-5 jours) → statut DB = "succeeded", Transfer créé
 * - Webhook payment_failed : Banque a refusé → statut DB = "failed"
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Object>} Résultat avec les PaymentIntents créés
 */
import { createSepaPaymentIntent } from "./sepaDirectDebit.service.js";
import { getMissionAgreementById, updateMissionAgreementStripeInfo } from "./missionAgreement.service.js";
import { createMissionPayment, updateMissionPaymentStatus } from "./missionPayment.service.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

export async function captureImmediatePaymentsOnAcceptance(missionAgreementId) {
  console.log(`🔄 [SEPA PAYMENT ORDERS] Creating SEPA payment orders for mission ${missionAgreementId} (T0 - Detailer acceptance)`);
  console.log(`ℹ️ [SEPA PAYMENT ORDERS] SEPA is ASYNCHRONOUS - PaymentIntents will be in "processing" state initially (NORMAL)`);

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
    console.log(`⚠️ [SEPA PAYMENT ORDERS] Payments already created for mission ${missionAgreementId}`);
    // Vérifier si déjà succeeded (argent reçu)
    const commissionPayment = existingPayments.find(p => p.type === "commission");
    const depositPayment = existingPayments.find(p => p.type === "deposit");
    
    if (commissionPayment?.status === "succeeded" && depositPayment?.status === "succeeded") {
      return {
        alreadyProcessed: true,
        commissionAmount: commissionPayment.amount,
        depositAmount: depositPayment.amount,
        totalAmount: commissionPayment.amount + depositPayment.amount,
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

    // 7) ✅ SEPA ASYNCHRONE : Créer DEUX PaymentIntents séparés (commission + acompte)
    // ⚠️ IMPORTANT : SEPA est ASYNCHRONE - les PaymentIntents seront en "processing" initialement
    // 
    // Flow SEPA :
    // 1. Créer les PaymentIntents avec confirm: true → statut = "processing" (NORMAL)
    // 2. Webhook payment_intent.processing → statut DB = "processing" (prélèvement envoyé)
    // 3. Webhook payment_intent.succeeded → statut DB = "succeeded" (argent reçu, 2-5 jours)
    // 4. Webhook payment_intent.payment_failed → statut DB = "failed" (banque a refusé)
    // 5. Après succeeded, créer Transfer vers Connected Account pour l'acompte
    
    console.log(`🔄 [SEPA PAYMENT ORDERS] Creating TWO separate PaymentIntents (SEPA async flow):`);
    console.log(`   - Commission: ${commissionAmount}€ (stays on platform after succeeded)`);
    console.log(`   - Deposit: ${depositAmount}€ (will be transferred via Transfer after succeeded)`);
    console.log(`ℹ️ [SEPA PAYMENT ORDERS] PaymentIntents will be in "processing" state initially (NORMAL for SEPA)`);
    
    // 7.1) Créer le PaymentIntent pour la COMMISSION (sur la plateforme, sans transfer)
    // ⚠️ Pas de capture_method pour SEPA - c'est automatique et asynchrone
    const commissionPaymentIntent = await createSepaPaymentIntent({
      companyUserId: agreement.companyId,
      amount: commissionAmount,
      currency: "eur",
      paymentMethodId: null, // Utilise le payment method par défaut (SEPA mandate)
      applicationFeeAmount: null, // ✅ Pas de application_fee_amount avec SEPA
      captureMethod: null, // ✅ SEPA n'a pas besoin de capture_method (automatique)
      metadata: {
        missionAgreementId: agreement.id,
        paymentId: commissionPayment.id, // ✅ Ajouter paymentId pour le webhook
        type: "mission_immediate_capture",
        paymentType: "commission",
        userId: agreement.companyId,
        commissionAmount: commissionAmount.toString(),
        createdAt: "T0", // T0 = ordre de prélèvement créé
      },
    });
    
    // 7.2) Créer le PaymentIntent pour l'ACOMPTE (sur la plateforme, sans transfer)
    const depositPaymentIntent = await createSepaPaymentIntent({
      companyUserId: agreement.companyId,
      amount: depositAmount,
      currency: "eur",
      paymentMethodId: null, // Utilise le payment method par défaut (SEPA mandate)
      applicationFeeAmount: null, // ✅ Pas de application_fee_amount avec SEPA
      captureMethod: null, // ✅ SEPA n'a pas besoin de capture_method (automatique)
      metadata: {
        missionAgreementId: agreement.id,
        paymentId: depositPayment.id, // ✅ Ajouter paymentId pour le webhook
        type: "mission_immediate_capture",
        paymentType: "deposit",
        userId: agreement.companyId,
        depositAmount: depositAmount.toString(),
        stripeConnectedAccountId: agreement.stripeConnectedAccountId, // ✅ Pour le Transfer ultérieur
        holdUntil: "J+1", // ✅ Indique que l'acompte ne doit pas être retiré avant J+1
        createdAt: "T0", // T0 = ordre de prélèvement créé
        note: "Deposit will be transferred to detailer via Transfer after payment succeeded", // Note pour documentation
      },
    });

    // 7.3) Vérifier que les PaymentIntents sont bien créés
    let commissionPI = await stripe.paymentIntents.retrieve(commissionPaymentIntent.id);
    let depositPI = await stripe.paymentIntents.retrieve(depositPaymentIntent.id);
    
    console.log(`✅ [SEPA PAYMENT ORDERS] Commission PaymentIntent created: ${commissionPI.id}, status: ${commissionPI.status}`);
    console.log(`✅ [SEPA PAYMENT ORDERS] Deposit PaymentIntent created: ${depositPI.id}, status: ${depositPI.status}`);
    
    // ⚠️ IMPORTANT : Pour SEPA, le statut peut être :
    // - "processing" : Prélèvement envoyé à la banque (NORMAL, attendu)
    // - "succeeded" : Argent reçu (rare immédiatement, généralement 2-5 jours après)
    // - "requires_payment_method" : Erreur (payment_method null ou mandate invalide)
    // - "payment_failed" : Banque a refusé
    
    if (commissionPI.status === "requires_payment_method" || depositPI.status === "requires_payment_method") {
      const errorMsg = `PaymentIntent creation failed - payment_method is null or mandate invalid. Commission PI: ${commissionPI.status}, Deposit PI: ${depositPI.status}`;
      console.error(`❌ [SEPA PAYMENT ORDERS] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // 7.4) ✅ Mettre à jour les paiements avec les statuts INITIAUX (processing ou succeeded)
    // Le statut sera mis à jour automatiquement via webhooks
    
    // Commission : Statut initial basé sur le PaymentIntent
    const commissionStatus = commissionPI.status === "succeeded" ? "succeeded" : "processing";
    await updateMissionPaymentStatus(commissionPayment.id, commissionStatus, {
      stripePaymentIntentId: commissionPaymentIntent.id,
      stripeChargeId: commissionPI.latest_charge || null,
      capturedAt: commissionPI.status === "succeeded" ? new Date().toISOString() : null, // Seulement si succeeded
    });

    // Acompte : Statut initial basé sur le PaymentIntent
    const depositStatus = depositPI.status === "succeeded" ? "succeeded" : "processing";
    await updateMissionPaymentStatus(depositPayment.id, depositStatus, {
      stripePaymentIntentId: depositPaymentIntent.id,
      stripeChargeId: depositPI.latest_charge || null,
      capturedAt: depositPI.status === "succeeded" ? new Date().toISOString() : null, // Seulement si succeeded
      holdUntil: new Date(new Date(agreement.startDate).getTime() + 24 * 60 * 60 * 1000).toISOString(), // J+1
      // Note: Le Transfer sera créé automatiquement via webhook payment_intent.succeeded
    });
    
    // 7.5) ✅ Si le paiement de l'acompte est déjà succeeded, créer le Transfer immédiatement
    if (depositPI.status === "succeeded" && depositPI.latest_charge) {
      console.log(`🔄 [SEPA PAYMENT ORDERS] Deposit payment already succeeded, creating Transfer to detailer...`);
      try {
        const { createTransferToDetailer } = await import("./missionPayout.service.js");
        const transferResult = await createTransferToDetailer({
          missionAgreementId: agreement.id,
          paymentId: depositPayment.id,
          amount: depositAmount,
          commissionRate: 0, // ✅ Pas de commission sur l'acompte (déjà capturée séparément)
        });
        
        console.log(`✅ [SEPA PAYMENT ORDERS] Deposit transferred to detailer: ${transferResult.id}, amount: ${transferResult.amount}€`);
        
        // Mettre à jour le statut du paiement à "transferred"
        await updateMissionPaymentStatus(depositPayment.id, "transferred", {
          transferredAt: new Date().toISOString(),
          stripeTransferId: transferResult.id,
        });
      } catch (transferError) {
        console.error(`⚠️ [SEPA PAYMENT ORDERS] Error creating transfer (will be retried via webhook/cron):`, transferError);
        // Ne pas faire échouer, le Transfer sera créé via webhook ou cron job
      }
    } else {
      console.log(`ℹ️ [SEPA PAYMENT ORDERS] Deposit payment status: ${depositPI.status} (${depositPI.status === "processing" ? "prélèvement envoyé à la banque, en attente de confirmation" : "autre statut"})`);
      console.log(`ℹ️ [SEPA PAYMENT ORDERS] Transfer will be created automatically via webhook payment_intent.succeeded (typically 2-5 days)`);
    }

    results.commissionPaymentId = commissionPayment.id;
    results.depositPaymentId = depositPayment.id;
    results.commissionPaymentIntentId = commissionPaymentIntent.id;
    results.depositPaymentIntentId = depositPaymentIntent.id; // ✅ Deux PaymentIntents séparés
    results.commissionCaptured = commissionAmount;
    results.depositCaptured = depositAmount;
    results.totalCaptured = commissionAmount + depositAmount;

    console.log(`✅ [SEPA PAYMENT ORDERS] Commission payment order created: ${commissionAmount}€ (PaymentIntent: ${commissionPaymentIntent.id}, status: ${commissionPI.status})`);
    console.log(`✅ [SEPA PAYMENT ORDERS] Deposit payment order created: ${depositAmount}€ (PaymentIntent: ${depositPaymentIntent.id}, status: ${depositPI.status})`);
    console.log(`✅ [SEPA PAYMENT ORDERS] Total payment orders created: ${results.totalCaptured}€`);
    
    if (commissionPI.status === "processing" || depositPI.status === "processing") {
      console.log(`ℹ️ [SEPA PAYMENT ORDERS] PaymentIntents are in "processing" state (NORMAL for SEPA)`);
      console.log(`ℹ️ [SEPA PAYMENT ORDERS] Prélèvements envoyés à la banque, en attente de confirmation (2-5 jours)`);
      console.log(`ℹ️ [SEPA PAYMENT ORDERS] Webhooks will update status automatically: processing → succeeded`);
    }
    
    if (commissionPI.status === "succeeded" && depositPI.status === "succeeded") {
      console.log(`✅ [SEPA PAYMENT ORDERS] Both payments already succeeded (rare but possible)`);
    }
    
    console.log(`ℹ️ [SEPA PAYMENT ORDERS] Deposit will be transferred to detailer Connected Account via Transfer after payment succeeded`);
    console.log(`⚠️ [SEPA PAYMENT ORDERS] NOTE: Deposit should not be withdrawn before J+1 (${new Date(new Date(agreement.startDate).getTime() + 24 * 60 * 60 * 1000).toISOString()})`);

    return results;

  } catch (error) {
    console.error(`❌ [SEPA PAYMENT ORDERS] Error creating payment orders:`, error);
    throw error;
  }
}
