// src/services/missionPaymentOnSession.service.js
/**
 * 🟦 CONFIRM MISSION PAYMENT ON-SESSION – Confirmer le paiement SEPA ON-SESSION (Company)
 * 
 * ⚠️ CRITICAL : SEPA doit être confirmé ON-SESSION pour éviter les blocages Stripe Radar
 * 
 * Flow :
 * 1. Company confirme le paiement dans l'app (action humaine visible)
 * 2. Créer UN SEUL PaymentIntent (acompte + commission) avec off_session: false
 * 3. Confirmer immédiatement avec confirm: true
 * 4. Statut = "processing" (normal pour SEPA)
 * 5. Webhook payment_intent.succeeded → Mission passe à "active", Transfer planifié
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @param {string} companyUserId - ID de la company
 * @returns {Promise<Object>} { paymentIntentId, clientSecret, amount, status }
 */
import { createSepaPaymentIntent } from "./sepaDirectDebit.service.js";
import { getMissionAgreementById } from "./missionAgreement.service.js";
import { createMissionPayment, updateMissionPaymentStatus } from "./missionPayment.service.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

export async function confirmMissionPaymentOnSession(missionAgreementId, companyUserId) {
  console.log(`🔄 [SEPA ON-SESSION] Confirming mission payment ON-SESSION for agreement ${missionAgreementId} (Company: ${companyUserId})`);

  // 1) Vérifier que le Mission Agreement existe et appartient à cette company
  const agreement = await getMissionAgreementById(missionAgreementId);
  
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  if (agreement.companyId !== companyUserId) {
    throw new Error("Forbidden: This agreement does not belong to this company");
  }

  // 2) Vérifier que le statut est "agreement_fully_confirmed"
  if (agreement.status !== "agreement_fully_confirmed") {
    throw new Error(`Mission Agreement cannot be paid. Current status: ${agreement.status}`);
  }

  // 2.1) ✅ VERROUILLAGE ANTI-DOUBLE PAIEMENT
  // Vérifier que payment_status est "pending_confirmation" (pas déjà payé)
  const { data: agreementWithPaymentStatus, error: statusError } = await supabase
    .from("mission_agreements")
    .select("payment_status, payment_confirmed_at, stripe_payment_intent_id")
    .eq("id", missionAgreementId)
    .single();

  if (statusError) throw statusError;

  const currentPaymentStatus = agreementWithPaymentStatus?.payment_status || "pending_confirmation";

  if (currentPaymentStatus !== "pending_confirmation") {
    const err = new Error(`Payment already processed. Current payment status: ${currentPaymentStatus}`);
    err.statusCode = 400;
    throw err;
  }

  // 3) Vérifier que les paiements n'ont pas déjà été créés
  const { data: existingPayments, error: existingError } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("mission_agreement_id", missionAgreementId)
    .in("type", ["commission", "deposit"]);

  if (existingError) {
    throw existingError;
  }

  if (existingPayments && existingPayments.length > 0) {
    const commissionPayment = existingPayments.find(p => p.type === "commission");
    const depositPayment = existingPayments.find(p => p.type === "deposit");
    
    if (commissionPayment?.status === "succeeded" && depositPayment?.status === "succeeded") {
      return {
        alreadyProcessed: true,
        commissionAmount: commissionPayment.amount,
        depositAmount: depositPayment.amount,
        totalAmount: commissionPayment.amount + depositPayment.amount,
        paymentIntentId: commissionPayment.stripe_payment_intent_id,
      };
    }
  }

  // 4) Calculer les montants
  const totalAmount = agreement.finalPrice; // 3000€
  const commissionAmount = Math.round(totalAmount * MISSION_COMMISSION_RATE * 100) / 100; // 210€ (7%)
  const depositAmount = agreement.depositAmount || Math.round((totalAmount * 0.20) * 100) / 100; // 600€ (20%)
  const combinedAmount = commissionAmount + depositAmount; // 810€

  console.log(`💰 [SEPA ON-SESSION] Total: ${totalAmount}€, Commission: ${commissionAmount}€, Deposit: ${depositAmount}€, Combined: ${combinedAmount}€`);

  // 5) Vérifier le SEPA mandate
  const { getSepaMandate } = await import("./sepaDirectDebit.service.js");
  const sepaMandate = await getSepaMandate(agreement.companyId);

  if (!sepaMandate || sepaMandate.status !== "active") {
    throw new Error("SEPA mandate is not active. Please set up SEPA Direct Debit first.");
  }

  // 5.1) ✅ Vérifier si la validation 1€ a été effectuée
  const { checkIfSepaValidationNeeded } = await import("./sepaMandateValidation.service.js");
  const validationStatus = await checkIfSepaValidationNeeded(agreement.companyId);

  if (validationStatus.needsValidation) {
    const err = new Error("SEPA_VALIDATION_REQUIRED: Votre compte SEPA nécessite une validation avant de pouvoir créer des paiements. Un paiement test de 1€ sera effectué et immédiatement remboursé.");
    err.statusCode = 400;
    err.code = "SEPA_VALIDATION_REQUIRED";
    err.requiresValidation = true;
    err.validationStatus = validationStatus;
    throw err;
  }

  // 6) Vérifier le Stripe Connected Account du detailer
  if (!agreement.stripeConnectedAccountId) {
    throw new Error("Detailer Stripe Connected Account ID not found. Please complete Stripe Connect onboarding first.");
  }

  // 7) Créer les paiements dans la DB (commission et acompte)
  console.log(`🔄 [SEPA ON-SESSION] Creating commission and deposit payments in DB`);
  
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

  // 8) ✅ CRÉER UN SEUL PaymentIntent (acompte + commission) avec off_session: false
  // C'est la clé pour éviter les blocages Stripe Radar
  console.log(`🔄 [SEPA ON-SESSION] Creating SINGLE PaymentIntent (deposit + commission) with off_session: false`);
  console.log(`   - Amount: ${combinedAmount}€ (${depositAmount}€ deposit + ${commissionAmount}€ commission)`);
  console.log(`   - off_session: false (ON-SESSION confirmation required)`);
  console.log(`   - confirm: true (immediate confirmation)`);
  
  // 8.1) Récupérer le payment method SEPA par défaut depuis le mandate
  const { data: companyUser } = await supabase
    .from("users")
    .select("stripe_customer_id")
    .eq("id", agreement.companyId)
    .single();

  if (!companyUser?.stripe_customer_id) {
    throw new Error("Company Stripe Customer ID not found");
  }

  // 8.2) Utiliser le mandate SEPA déjà récupéré (ligne 102) pour obtenir le payment method
  if (!sepaMandate || !sepaMandate.paymentMethodId) {
    throw new Error("No active SEPA mandate found. Please set up SEPA Direct Debit first.");
  }

  const sepaPaymentMethodId = sepaMandate.paymentMethodId;

  // 8.3) Créer le PaymentIntent avec off_session: false et confirm: true
  // ⚠️ CRITICAL: off_session: false = ON-SESSION (action humaine visible pour Stripe Radar)
  // ✅ IDEMPOTENCY KEY: Empêche les doubles paiements en cas de retry réseau
  const idempotencyKey = `mission_payment_${missionAgreementId}_${Date.now()}`;
  
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(combinedAmount * 100), // 81000 centimes
    currency: "eur",
    customer: companyUser.stripe_customer_id,
    payment_method: sepaPaymentMethodId,
    confirmation_method: "automatic",
    confirm: true, // ✅ Confirmation immédiate
    off_session: false, // ✅ CRITICAL: ON-SESSION pour éviter les blocages Radar
    capture_method: "automatic_async", // SEPA est asynchrone
    payment_method_types: ["sepa_debit"],
    metadata: {
      missionAgreementId: agreement.id,
      commissionPaymentId: commissionPayment.id,
      depositPaymentId: depositPayment.id,
      type: "mission_payment_on_session",
      paymentType: "combined", // Acompte + commission combinés
      userId: agreement.companyId,
      commissionAmount: commissionAmount.toString(),
      depositAmount: depositAmount.toString(),
      totalAmount: combinedAmount.toString(),
      stripeConnectedAccountId: agreement.stripeConnectedAccountId, // Pour le Transfer ultérieur
      holdUntil: "J+1", // Acompte retenu jusqu'à J+1
      createdAt: "T0",
    },
    transfer_group: `mission_${agreement.id}`, // ✅ Pour le transfer planifié
  }, {
    idempotencyKey: idempotencyKey, // ✅ Empêche les doubles paiements
  });

  console.log(`✅ [SEPA ON-SESSION] PaymentIntent created: ${paymentIntent.id}, status: ${paymentIntent.status}`);

  // 9) Mettre à jour les paiements avec le PaymentIntent
  const initialStatus = paymentIntent.status === "succeeded" ? "succeeded" : "processing";
  
  await updateMissionPaymentStatus(commissionPayment.id, initialStatus, {
    stripePaymentIntentId: paymentIntent.id,
    stripeChargeId: paymentIntent.latest_charge || null,
    capturedAt: paymentIntent.status === "succeeded" ? new Date().toISOString() : null,
  });

  await updateMissionPaymentStatus(depositPayment.id, initialStatus, {
    stripePaymentIntentId: paymentIntent.id, // ✅ Même PaymentIntent pour les deux
    stripeChargeId: paymentIntent.latest_charge || null,
    capturedAt: paymentIntent.status === "succeeded" ? new Date().toISOString() : null,
    holdUntil: new Date(new Date(agreement.startDate).getTime() + 24 * 60 * 60 * 1000).toISOString(), // J+1
  });

  // 10) Si le paiement est déjà succeeded, créer le Transfer immédiatement
  if (paymentIntent.status === "succeeded" && paymentIntent.latest_charge) {
    console.log(`🔄 [SEPA ON-SESSION] Payment already succeeded, creating Transfer to detailer...`);
    try {
      const { createTransferToDetailer } = await import("./missionPayout.service.js");
      const transferResult = await createTransferToDetailer({
        missionAgreementId: agreement.id,
        paymentId: depositPayment.id,
        amount: depositAmount,
        commissionRate: 0, // Pas de commission sur l'acompte (déjà capturée)
      });
      
      console.log(`✅ [SEPA ON-SESSION] Deposit transferred to detailer: ${transferResult.id}, amount: ${transferResult.amount}€`);
      
      await updateMissionPaymentStatus(depositPayment.id, "transferred", {
        transferredAt: new Date().toISOString(),
        stripeTransferId: transferResult.id,
      });
    } catch (transferError) {
      console.error(`⚠️ [SEPA ON-SESSION] Error creating transfer (will be retried via webhook/cron):`, transferError);
    }
  } else {
    console.log(`ℹ️ [SEPA ON-SESSION] Payment status: ${paymentIntent.status} (${paymentIntent.status === "processing" ? "prélèvement envoyé à la banque, en attente de confirmation" : "autre statut"})`);
    console.log(`ℹ️ [SEPA ON-SESSION] Transfer will be created automatically via webhook payment_intent.succeeded (typically 2-5 days)`);
  }

  // 11) ✅ Mettre à jour le statut du Mission Agreement et les colonnes d'audit
  const now = new Date().toISOString();
  const startDate = new Date(agreement.startDate);
  const jPlusOne = new Date(startDate.getTime() + 24 * 60 * 60 * 1000); // J+1
  
  await supabase
    .from("mission_agreements")
    .update({
      status: "active",
      payment_status: paymentIntent.status === "succeeded" ? "succeeded" : "processing", // ✅ Statut de paiement
      payment_confirmed_at: now, // ✅ Horodatage de confirmation
      stripe_payment_intent_id: paymentIntent.id,
      scheduled_transfer_at: jPlusOne.toISOString(), // ✅ Date planifiée pour le transfer (J+1)
      updated_at: now,
    })
    .eq("id", missionAgreementId);

  console.log(`✅ [SEPA ON-SESSION] Mission Agreement status updated to "active"`);

  return {
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    amount: combinedAmount,
    commissionAmount,
    depositAmount,
    status: paymentIntent.status,
    commissionPaymentId: commissionPayment.id,
    depositPaymentId: depositPayment.id,
  };
}
