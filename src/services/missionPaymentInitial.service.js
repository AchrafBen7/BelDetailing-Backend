// src/services/missionPaymentInitial.service.js
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { getSepaMandate } from "./sepaDirectDebit.service.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

/**
 * 🟦 CREATE INITIAL PAYMENTS – Créer les paiements initiaux après double acceptation
 * 
 * Crée automatiquement :
 * 1. Payment Intent pour l'acompte (gelé, capturé à la fin du premier jour)
 * 2. Payment Intent pour la commission NIOS (7% du total, unique, capturé immédiatement)
 * 
 * @param {string} agreementId - ID du Mission Agreement
 * @returns {Promise<Object>} { depositPaymentIntent, commissionPaymentIntent }
 */
export async function createInitialPayments(agreementId) {
  // 1) Récupérer le Mission Agreement
  const { data: agreement, error: agreementError } = await supabase
    .from("mission_agreements")
    .select("*")
    .eq("id", agreementId)
    .single();

  if (agreementError) throw agreementError;
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  // 2) Vérifier le statut
  if (agreement.status !== "agreement_fully_confirmed") {
    throw new Error(`Cannot create initial payments. Agreement status must be 'agreement_fully_confirmed'. Current status: ${agreement.status}`);
  }

  // 3) Vérifier que les dates sont définies
  if (!agreement.start_date) {
    throw new Error("Cannot create initial payments. Start date must be defined.");
  }

  // 4) Vérifier le SEPA mandate de la company
  const sepaMandate = await getSepaMandate(agreement.company_id);
  if (!sepaMandate || sepaMandate.status !== "active") {
    throw new Error("SEPA mandate required. Company must have an active SEPA mandate.");
  }

  if (!sepaMandate.paymentMethodId) {
    throw new Error("No active SEPA payment method found. Please set up SEPA Direct Debit first.");
  }

  // 5) Vérifier le Stripe Connected Account du detailer
  if (!agreement.stripe_connected_account_id) {
    throw new Error("Detailer Stripe Connected Account ID not found. Please complete Stripe Connect onboarding first.");
  }

  // 6) Calculer les montants
  const finalPrice = Number(agreement.final_price);
  const depositAmount = Number(agreement.deposit_amount) || 0;
  const commissionAmount = Math.round(finalPrice * MISSION_COMMISSION_RATE * 100) / 100; // 7% en euros
  const commissionAmountCents = Math.round(commissionAmount * 100); // En centimes pour Stripe

  // 7) Récupérer ou créer le Stripe Customer de la company
  let customerId = agreement.stripe_customer_id;
  if (!customerId) {
    const { data: companyUser } = await supabase
      .from("users")
      .select("email, phone")
      .eq("id", agreement.company_id)
      .single();

    const customer = await stripe.customers.create({
      email: companyUser?.email,
      phone: companyUser?.phone,
      metadata: {
        userId: agreement.company_id,
        type: "company",
      },
    });

    customerId = customer.id;

    // Sauvegarder dans mission_agreements
    await supabase
      .from("mission_agreements")
      .update({ stripe_customer_id: customerId })
      .eq("id", agreementId);
  }

  // 8) Créer le Payment Intent pour la commission NIOS (capturé immédiatement)
  // ⚠️ La commission NIOS est un paiement direct à NIOS, pas via Stripe Connect
  
  const commissionPaymentIntent = await stripe.paymentIntents.create({
    amount: commissionAmountCents,
    currency: "eur",
    customer: customerId,
    payment_method: sepaMandate.paymentMethodId,
    payment_method_types: ["sepa_debit"],
    capture_method: "manual", // SEPA nécessite toujours manual, mais on capture rapidement
    off_session: true,
    confirm: true, // Confirmer automatiquement pour SEPA
    metadata: {
      missionAgreementId: agreementId,
      paymentType: "commission",
      userId: agreement.company_id,
      type: "mission_commission",
      commissionAmount: commissionAmount.toString(),
      commissionRate: MISSION_COMMISSION_RATE.toString(),
    },
  });

  // ⚠️ IMPORTANT : Pour SEPA, on ne peut pas vraiment "capturer immédiatement"
  // SEPA fonctionne avec des prélèvements qui prennent quelques jours
  // On marque quand même comme "paid" dans notre DB car c'est un engagement bancaire
  // On tente quand même la capture (elle sera traitée par Stripe)
  try {
    if (commissionPaymentIntent.status === "requires_capture") {
      await stripe.paymentIntents.capture(commissionPaymentIntent.id);
      console.log(`✅ [INITIAL PAYMENTS] Commission NIOS captured: ${commissionAmount}€ (${commissionPaymentIntent.id})`);
    }
  } catch (captureError) {
    console.warn(`⚠️ [INITIAL PAYMENTS] Could not capture commission immediately (SEPA delay expected):`, captureError.message);
  }

  // 10) Créer le Payment Intent pour l'acompte (gelé, capturé à la fin du premier jour)
  // ⚠️ IMPORTANT : L'acompte est transféré au detailer via Stripe Connect
  // Mais on ne prend PAS de commission supplémentaire (la commission est déjà prise sur le total)
  const depositAmountCents = Math.round(depositAmount * 100);
  
  const depositPaymentIntent = await stripe.paymentIntents.create({
    amount: depositAmountCents,
    currency: "eur",
    customer: customerId,
    payment_method: sepaMandate.paymentMethodId,
    payment_method_types: ["sepa_debit"],
    capture_method: "manual", // ⚠️ IMPORTANT : Gelé, pas encore capturé
    off_session: true,
    confirm: true, // Confirmer automatiquement pour SEPA
    // ⚠️ IMPORTANT : Utiliser Stripe Connect pour transférer l'acompte au detailer
    // Sans commission supplémentaire (application_fee_amount = 0 signifie tout transférer)
    on_behalf_of: agreement.stripe_connected_account_id,
    transfer_data: {
      destination: agreement.stripe_connected_account_id,
    },
    metadata: {
      missionAgreementId: agreementId,
      paymentType: "deposit",
      userId: agreement.company_id,
      type: "mission_deposit",
      stripeConnectedAccountId: agreement.stripe_connected_account_id,
      scheduledCaptureDate: new Date(agreement.start_date).toISOString().split('T')[0] + "T23:59:59Z", // Fin du premier jour
    },
  });
  
  // ⚠️ IMPORTANT : Le Payment Intent est créé avec capture_method: "manual"
  // Il sera capturé automatiquement à la fin du premier jour via cron job
  console.log(`✅ [INITIAL PAYMENTS] Deposit Payment Intent created (frozen): ${depositAmount}€ (${depositPaymentIntent.id})`);

  // 10) Enregistrer les Payment Intents dans mission_agreements
  await supabase
    .from("mission_agreements")
    .update({
      stripe_payment_intent_id: depositPaymentIntent.id, // Acompte principal
      updated_at: new Date().toISOString(),
    })
    .eq("id", agreementId);

  // 11) Créer les enregistrements dans mission_payments pour tracking
  const startDate = new Date(agreement.start_date);
  const endOfFirstDay = new Date(startDate);
  endOfFirstDay.setHours(23, 59, 59, 999);

  // Commission (immédiate)
  await supabase.from("mission_payments").insert({
    mission_agreement_id: agreementId,
    type: "commission",
    amount: commissionAmount,
    currency: "eur",
    status: "paid", // Déjà capturé
    stripe_payment_intent_id: commissionPaymentIntent.id,
    scheduled_date: new Date().toISOString(), // Immédiat
    created_at: new Date().toISOString(),
  });

  // Acompte (gelé, capturé fin du premier jour)
  await supabase.from("mission_payments").insert({
    mission_agreement_id: agreementId,
    type: "deposit",
    amount: depositAmount,
    currency: "eur",
    status: "authorized", // Gelé, pas encore capturé
    stripe_payment_intent_id: depositPaymentIntent.id,
    scheduled_date: endOfFirstDay.toISOString(), // Fin du premier jour
    created_at: new Date().toISOString(),
  });

  return {
    depositPaymentIntent: {
      id: depositPaymentIntent.id,
      clientSecret: depositPaymentIntent.client_secret,
      amount: depositAmount,
      currency: "eur",
      status: depositPaymentIntent.status, // "requires_capture"
      scheduledCaptureDate: endOfFirstDay.toISOString(),
    },
    commissionPaymentIntent: {
      id: commissionPaymentIntent.id,
      amount: commissionAmount,
      currency: "eur",
      status: commissionPaymentIntent.status, // "succeeded" ou "requires_capture" (SEPA delay)
      captured: commissionPaymentIntent.status === "succeeded",
    },
  };
}
