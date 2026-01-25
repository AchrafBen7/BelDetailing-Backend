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

    // 7) Créer UN SEUL PaymentIntent pour le montant total (commission + acompte)
    // ✅ Utiliser application_fee_amount pour la commission (apparaîtra dans "Collected fees" de Stripe)
    // ⚠️ IMPORTANT: Pour que application_fee_amount fonctionne et apparaisse dans "Collected fees",
    // il faut utiliser on_behalf_of + transfer_data avec le Connected Account du detailer
    // 
    // Comportement Stripe :
    // - Le montant total est prélevé de la company
    // - La commission (application_fee_amount) est collectée par NIOS (apparaît dans "Collected fees")
    // - Le reste (acompte) est transféré au Connected Account du detailer
    // 
    // ⚠️ NOTE: L'acompte sera transféré immédiatement au Connected Account, mais on documente
    // qu'il ne doit pas être retiré avant J+1 (géré par accord contractuel)
    const totalAmount = commissionAmount + depositAmount;
    console.log(`🔄 [IMMEDIATE CAPTURE] Creating PaymentIntent for total: ${totalAmount}€ (Commission: ${commissionAmount}€ + Deposit: ${depositAmount}€)`);
    console.log(`🔄 [IMMEDIATE CAPTURE] Using application_fee_amount: ${Math.round(commissionAmount * 100)} cents (will appear in Stripe "Collected fees")`);
    console.log(`🔄 [IMMEDIATE CAPTURE] Deposit (${depositAmount}€) will be transferred to detailer Connected Account: ${agreement.stripeConnectedAccountId}`);
    
    // 7.1) Créer le PaymentIntent avec application_fee_amount pour la commission
    // ✅ On utilise on_behalf_of + transfer_data pour que application_fee_amount fonctionne
    // ✅ La commission sera collectée immédiatement (apparaîtra dans "Collected fees")
    // ✅ L'acompte sera transféré au Connected Account (mais ne doit pas être retiré avant J+1)
    const totalPaymentIntent = await createSepaPaymentIntent({
      companyUserId: agreement.companyId,
      amount: totalAmount, // Commission + Acompte
      currency: "eur",
      paymentMethodId: null,
      applicationFeeAmount: Math.round(commissionAmount * 100), // ✅ Commission en centimes (apparaîtra dans "Collected fees")
      captureMethod: "automatic", // ✅ Capture automatique immédiate
      metadata: {
        missionAgreementId: agreement.id,
        commissionPaymentId: commissionPayment.id,
        depositPaymentId: depositPayment.id,
        type: "mission_immediate_capture",
        paymentType: "commission_and_deposit",
        userId: agreement.companyId,
        commissionAmount: commissionAmount.toString(),
        depositAmount: depositAmount.toString(),
        stripeConnectedAccountId: agreement.stripeConnectedAccountId, // ✅ Nécessaire pour application_fee_amount
        holdUntil: "J+1", // ✅ Indique que l'acompte ne doit pas être retiré avant J+1
        capturedAt: "T0", // T0 = immédiatement
        note: "Deposit transferred to detailer but should not be withdrawn before J+1", // Note pour documentation
      },
    });

    // 7.2) Capturer immédiatement (si pas déjà capturé automatiquement)
    let totalPI = await stripe.paymentIntents.retrieve(totalPaymentIntent.id);
    if (totalPI.status === "requires_capture") {
      await captureSepaPayment(totalPaymentIntent.id);
      totalPI = await stripe.paymentIntents.retrieve(totalPaymentIntent.id);
    }

    // 7.3) Mettre à jour les paiements avec les statuts
    // Commission : "captured" (collectée immédiatement via application_fee_amount)
    await updateMissionPaymentStatus(commissionPayment.id, "captured", {
      stripePaymentIntentId: totalPaymentIntent.id,
      stripeChargeId: totalPI.latest_charge || totalPaymentIntent.id,
      capturedAt: new Date().toISOString(),
    });

    // Acompte : "captured_held" (capturé et transféré immédiatement au Connected Account via Stripe Connect)
    // ⚠️ NOTE: L'acompte est transféré immédiatement au Connected Account via Stripe Connect (transfer_data),
    // mais le statut reste "captured_held" pour indiquer qu'il ne doit pas être retiré avant J+1
    // Le cron job releaseDepositsAtJPlusOne vérifiera si l'acompte est déjà transféré et ne créera pas de Transfer supplémentaire
    await updateMissionPaymentStatus(depositPayment.id, "captured_held", {
      stripePaymentIntentId: totalPaymentIntent.id,
      stripeChargeId: totalPI.latest_charge || totalPaymentIntent.id,
      capturedAt: new Date().toISOString(),
      holdUntil: new Date(new Date(agreement.startDate).getTime() + 24 * 60 * 60 * 1000).toISOString(), // J+1
      // Note: transferredAt et stripeTransferId ne sont pas définis car le transfert est fait automatiquement via Stripe Connect
      // Le cron job vérifiera si le PaymentIntent a déjà transféré l'argent avant de créer un Transfer supplémentaire
    });

    results.commissionPaymentId = commissionPayment.id;
    results.depositPaymentId = depositPayment.id;
    results.commissionPaymentIntentId = totalPaymentIntent.id;
    results.depositPaymentIntentId = totalPaymentIntent.id; // Même PaymentIntent pour les deux
    results.commissionCaptured = commissionAmount;
    results.depositCaptured = depositAmount;
    results.totalCaptured = totalAmount;

    console.log(`✅ [IMMEDIATE CAPTURE] Commission captured IMMEDIATELY via application_fee_amount: ${commissionAmount}€ (PaymentIntent: ${totalPaymentIntent.id})`);
    console.log(`✅ [IMMEDIATE CAPTURE] Commission will appear in Stripe Dashboard → "Collected fees"`);
    console.log(`✅ [IMMEDIATE CAPTURE] Deposit captured IMMEDIATELY and transferred to detailer Connected Account: ${depositAmount}€ (PaymentIntent: ${totalPaymentIntent.id})`);
    console.log(`✅ [IMMEDIATE CAPTURE] Deposit transferred to Connected Account: ${agreement.stripeConnectedAccountId}`);
    console.log(`✅ [IMMEDIATE CAPTURE] Total captured IMMEDIATELY: ${totalAmount}€`);
    console.log(`⚠️ [IMMEDIATE CAPTURE] NOTE: Deposit is transferred to detailer but should not be withdrawn before J+1 (${new Date(new Date(agreement.startDate).getTime() + 24 * 60 * 60 * 1000).toISOString()})`);

    return results;

  } catch (error) {
    console.error(`❌ [IMMEDIATE CAPTURE] Error capturing immediate payments:`, error);
    throw error;
  }
}
