// src/services/sepaDirectDebit.service.js
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

/**
 * 🟦 GET OR CREATE STRIPE CUSTOMER – Créer ou récupérer un Stripe Customer pour une company
 */
async function getOrCreateStripeCustomer(companyUserId) {
  // 1) Vérifier si la company a déjà un Stripe Customer ID
  const { data: companyUser, error } = await supabase
    .from("users")
    .select("id, email, phone, stripe_customer_id")
    .eq("id", companyUserId)
    .single();

  if (error) throw error;

  // 2) Si déjà un customer Stripe → retourner
  if (companyUser.stripe_customer_id) {
    return companyUser.stripe_customer_id;
  }

  // 3) Créer un nouveau Stripe Customer
  const customer = await stripe.customers.create({
    email: companyUser.email,
    phone: companyUser.phone ?? undefined,
    metadata: {
      userId: companyUserId,
      userRole: "company",
      source: "beldetailing-app",
    },
  });

  // 4) Sauvegarder dans la DB
  await supabase
    .from("users")
    .update({ stripe_customer_id: customer.id })
    .eq("id", companyUserId);

  return customer.id;
}

/**
 * 🟦 CREATE SETUP INTENT FOR SEPA – Créer un Setup Intent pour SEPA Direct Debit
 * 
 * @param {string} companyUserId - ID de la company
 * @returns {Promise<Object>} { setupIntentClientSecret, customerId }
 */
export async function createSepaSetupIntent(companyUserId) {
  // 1) Créer ou récupérer le Stripe Customer
  const customerId = await getOrCreateStripeCustomer(companyUserId);

  // 2) Créer un Setup Intent pour SEPA Direct Debit
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["sepa_debit"],
    usage: "off_session", // Pour prélèvements automatiques
    metadata: {
      userId: companyUserId,
      userRole: "company",
      source: "beldetailing-app",
    },
  });

  return {
    setupIntentClientSecret: setupIntent.client_secret,
    customerId,
    setupIntentId: setupIntent.id,
  };
}

/**
 * 🟦 GET SEPA MANDATE – Récupérer le mandate SEPA actif d'une company
 * 
 * @param {string} companyUserId - ID de la company
 * @returns {Promise<Object|null>} Mandate SEPA ou null
 */
export async function getSepaMandate(companyUserId) {
  // 1) Récupérer le Stripe Customer ID
  const { data: companyUser, error } = await supabase
    .from("users")
    .select("stripe_customer_id")
    .eq("id", companyUserId)
    .single();

  if (error || !companyUser?.stripe_customer_id) {
    return null;
  }

  // 2) Récupérer les payment methods SEPA du customer
  const paymentMethods = await stripe.paymentMethods.list({
    customer: companyUser.stripe_customer_id,
    type: "sepa_debit",
  });

  if (paymentMethods.data.length === 0) {
    return null;
  }

  // 3) Récupérer le mandate associé au premier payment method SEPA
  const sepaPaymentMethod = paymentMethods.data[0];
  const mandateId = sepaPaymentMethod.sepa_debit?.mandate;

  if (!mandateId) {
    return null;
  }

  // 4) Récupérer le mandate depuis Stripe
  const mandate = await stripe.mandates.retrieve(mandateId);

  return {
    id: mandate.id,
    status: mandate.status, // active, inactive, pending
    type: mandate.type, // sepa_debit
    paymentMethodId: sepaPaymentMethod.id,
    customerId: companyUser.stripe_customer_id,
    details: {
      bankCode: sepaPaymentMethod.sepa_debit?.bank_code,
      branchCode: sepaPaymentMethod.sepa_debit?.branch_code,
      last4: sepaPaymentMethod.sepa_debit?.last4,
      fingerprint: sepaPaymentMethod.sepa_debit?.fingerprint,
    },
  };
}

/**
 * 🟦 LIST SEPA PAYMENT METHODS – Lister les moyens de paiement SEPA d'une company
 * 
 * @param {string} companyUserId - ID de la company
 * @returns {Promise<Array>} Liste des payment methods SEPA
 */
export async function listSepaPaymentMethods(companyUserId) {
  // 1) Récupérer le Stripe Customer ID
  const { data: companyUser, error } = await supabase
    .from("users")
    .select("stripe_customer_id")
    .eq("id", companyUserId)
    .single();

  if (error || !companyUser?.stripe_customer_id) {
    return [];
  }

  // 2) Récupérer les payment methods SEPA
  const paymentMethods = await stripe.paymentMethods.list({
    customer: companyUser.stripe_customer_id,
    type: "sepa_debit",
  });

  return paymentMethods.data.map((pm) => ({
    id: pm.id,
    type: pm.type,
    sepaDebit: {
      bankCode: pm.sepa_debit?.bank_code,
      branchCode: pm.sepa_debit?.branch_code,
      last4: pm.sepa_debit?.last4,
      fingerprint: pm.sepa_debit?.fingerprint,
      mandate: pm.sepa_debit?.mandate,
    },
    created: pm.created,
  }));
}

/**
 * 🟦 DELETE SEPA PAYMENT METHOD – Supprimer un moyen de paiement SEPA
 * 
 * @param {string} companyUserId - ID de la company
 * @param {string} paymentMethodId - ID du payment method à supprimer
 */
export async function deleteSepaPaymentMethod(companyUserId, paymentMethodId) {
  // 1) Vérifier que le payment method appartient à cette company
  const { data: companyUser, error } = await supabase
    .from("users")
    .select("stripe_customer_id")
    .eq("id", companyUserId)
    .single();

  if (error || !companyUser?.stripe_customer_id) {
    throw new Error("Company not found or no Stripe customer");
  }

  // 2) Récupérer le payment method pour vérifier qu'il appartient au customer
  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

  if (paymentMethod.customer !== companyUser.stripe_customer_id) {
    throw new Error("Payment method does not belong to this company");
  }

  // 3) Détacher le payment method
  await stripe.paymentMethods.detach(paymentMethodId);

  return { success: true };
}

/**
 * 🟦 CREATE PAYMENT INTENT WITH SEPA – Créer un Payment Intent avec SEPA Direct Debit
 * 
 * @param {Object} params
 * @param {string} params.companyUserId - ID de la company
 * @param {number} params.amount - Montant en euros
 * @param {string} params.currency - Devise (default: "eur")
 * @param {string} params.paymentMethodId - ID du payment method SEPA (optionnel, utilise le défaut si non fourni)
 * @param {Object} params.metadata - Métadonnées additionnelles
 * @returns {Promise<Object>} Payment Intent avec client_secret
 */
export async function createSepaPaymentIntent({
  companyUserId,
  amount,
  currency = "eur",
  paymentMethodId = null,
  metadata = {},
}) {
  // 1) Créer ou récupérer le Stripe Customer
  const customerId = await getOrCreateStripeCustomer(companyUserId);

  // 2) Si paymentMethodId non fourni, récupérer le payment method SEPA par défaut
  let finalPaymentMethodId = paymentMethodId;

  if (!finalPaymentMethodId) {
    const paymentMethods = await listSepaPaymentMethods(companyUserId);
    if (paymentMethods.length === 0) {
      throw new Error("No SEPA payment method found. Please set up SEPA Direct Debit first.");
    }
    finalPaymentMethodId = paymentMethods[0].id;
  }

  // 3) Créer le Payment Intent avec capture_method: "manual" (pour autorisation puis capture)
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100), // Convertir en centimes
    currency,
    customer: customerId,
    payment_method: finalPaymentMethodId,
    payment_method_types: ["sepa_debit"],
    capture_method: "manual", // Autorisation puis capture manuelle
    off_session: true, // Prélèvement automatique (off-session)
    confirm: true, // Confirmer automatiquement (pour SEPA off-session)
    metadata: {
      userId: companyUserId,
      userRole: "company",
      source: "beldetailing-app",
      ...metadata,
    },
  });

  return {
    id: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    status: paymentIntent.status,
    amount: paymentIntent.amount / 100, // Reconvertir en euros
    currency: paymentIntent.currency,
  };
}

/**
 * 🟦 CAPTURE SEPA PAYMENT – Capturer un paiement SEPA pré-autorisé
 * 
 * @param {string} paymentIntentId - ID du Payment Intent
 * @returns {Promise<Object>} Payment Intent capturé
 */
export async function captureSepaPayment(paymentIntentId) {
  const paymentIntent = await stripe.paymentIntents.capture(paymentIntentId);

  return {
    id: paymentIntent.id,
    status: paymentIntent.status,
    amount: paymentIntent.amount / 100,
    currency: paymentIntent.currency,
    captured: paymentIntent.amount_capturable === 0,
  };
}

/**
 * 🟦 CANCEL SEPA PAYMENT – Annuler un paiement SEPA pré-autorisé
 * 
 * @param {string} paymentIntentId - ID du Payment Intent
 * @returns {Promise<Object>} Payment Intent annulé
 */
export async function cancelSepaPayment(paymentIntentId) {
  const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);

  return {
    id: paymentIntent.id,
    status: paymentIntent.status,
    cancelled: true,
  };
}
