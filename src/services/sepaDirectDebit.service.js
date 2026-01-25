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
  console.log("🔄 [SEPA] getOrCreateStripeCustomer called for:", companyUserId);
  
  try {
    // 1) Vérifier si la company a déjà un Stripe Customer ID
    console.log("🔄 [SEPA] Step 1: Checking existing Stripe customer in DB...");
    const { data: companyUser, error } = await supabase
      .from("users")
      .select("id, email, phone, stripe_customer_id")
      .eq("id", companyUserId)
      .single();

    if (error) {
      console.error("❌ [SEPA] Error fetching user from DB:", error);
      throw error;
    }

    console.log("📦 [SEPA] User data:", {
      id: companyUser.id,
      email: companyUser.email,
      hasStripeCustomerId: !!companyUser.stripe_customer_id,
    });

    // 2) Si déjà un customer Stripe → retourner
    if (companyUser.stripe_customer_id) {
      console.log("✅ [SEPA] Existing Stripe customer found:", companyUser.stripe_customer_id);
      return companyUser.stripe_customer_id;
    }

    // 3) Créer un nouveau Stripe Customer
    console.log("🔄 [SEPA] Step 2: Creating new Stripe customer...");
    const customerPayload = {
      email: companyUser.email,
      phone: companyUser.phone ?? undefined,
      metadata: {
        userId: companyUserId,
        userRole: "company",
        source: "beldetailing-app",
      },
    };
    console.log("📤 [SEPA] Stripe customer payload:", JSON.stringify(customerPayload, null, 2));
    
    const customer = await stripe.customers.create(customerPayload);
    console.log("✅ [SEPA] Step 2: Stripe customer created:", customer.id);

    // 4) Sauvegarder dans la DB
    console.log("🔄 [SEPA] Step 3: Saving Stripe customer ID to DB...");
    const { error: updateError } = await supabase
      .from("users")
      .update({ stripe_customer_id: customer.id })
      .eq("id", companyUserId);

    if (updateError) {
      console.error("❌ [SEPA] Error saving Stripe customer ID to DB:", updateError);
      throw updateError;
    }

    console.log("✅ [SEPA] Step 3: Stripe customer ID saved to DB");
    console.log("✅ [SEPA] getOrCreateStripeCustomer completed:", customer.id);
    return customer.id;
  } catch (error) {
    console.error("❌ [SEPA] getOrCreateStripeCustomer error:", error);
    console.error("❌ [SEPA] Error details:", {
      message: error.message,
      type: error.type,
      code: error.code,
      statusCode: error.statusCode,
    });
    throw error;
  }
}

/**
 * 🟦 CREATE SETUP INTENT FOR SEPA – Créer un Setup Intent pour SEPA Direct Debit
 * 
 * @param {string} companyUserId - ID de la company
 * @returns {Promise<Object>} { setupIntentClientSecret, customerId }
 */
export async function createSepaSetupIntent(companyUserId) {
  console.log("🔄 [SEPA] createSepaSetupIntent called for companyUserId:", companyUserId);
  
  try {
    // 1) Créer ou récupérer le Stripe Customer
    console.log("🔄 [SEPA] Step 1: Getting or creating Stripe customer...");
    const customerId = await getOrCreateStripeCustomer(companyUserId);
    console.log("✅ [SEPA] Step 1: Customer ID:", customerId);

    // 2) Créer un Ephemeral Key pour iOS (comme pour les cartes)
    console.log("🔄 [SEPA] Step 2: Creating Ephemeral Key...");
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: "2025-11-17.clover" }
    );
    console.log("✅ [SEPA] Step 2: Ephemeral Key created:", ephemeralKey.id);
    console.log("📦 [SEPA] Ephemeral Key secret exists:", !!ephemeralKey.secret);

    // 3) Créer un Setup Intent pour SEPA Direct Debit
    console.log("🔄 [SEPA] Step 3: Creating Stripe Setup Intent...");
    const setupIntentPayload = {
      customer: customerId,
      payment_method_types: ["sepa_debit"],
      usage: "off_session", // Pour prélèvements automatiques
      metadata: {
        userId: companyUserId,
        userRole: "company",
        source: "beldetailing-app",
      },
    };
    console.log("📤 [SEPA] Setup Intent payload:", JSON.stringify(setupIntentPayload, null, 2));
    
    const setupIntent = await stripe.setupIntents.create(setupIntentPayload);
    console.log("✅ [SEPA] Step 3: Setup Intent created successfully");
    console.log("📦 [SEPA] Setup Intent ID:", setupIntent.id);
    console.log("📦 [SEPA] Setup Intent status:", setupIntent.status);
    console.log("📦 [SEPA] Setup Intent client_secret exists:", !!setupIntent.client_secret);

    const result = {
      setupIntentClientSecret: setupIntent.client_secret,
      customerId,
      setupIntentId: setupIntent.id,
      ephemeralKeySecret: ephemeralKey.secret, // ✅ Ajouter l'ephemeral key
    };
    
    console.log("✅ [SEPA] createSepaSetupIntent completed successfully");
    return result;
  } catch (error) {
    console.error("❌ [SEPA] createSepaSetupIntent error:", error);
    console.error("❌ [SEPA] Error details:", {
      message: error.message,
      type: error.type,
      code: error.code,
      statusCode: error.statusCode,
      raw: error.raw,
    });
    throw error;
  }
}

/**
 * 🟦 GET SEPA MANDATE – Récupérer le mandate SEPA actif d'une company
 * 
 * Selon la documentation Stripe :
 * - Les mandates SEPA sont créés automatiquement lors de la confirmation d'un SetupIntent
 * - Le statut peut être : "active", "inactive", ou "pending"
 * - Un mandate actif est requis pour effectuer des prélèvements SEPA
 * 
 * @param {string} companyUserId - ID de la company
 * @returns {Promise<Object|null>} Mandate SEPA actif ou null
 */
export async function getSepaMandate(companyUserId) {
  try {
    // 1) Récupérer le Stripe Customer ID
    const { data: companyUser, error } = await supabase
      .from("users")
      .select("stripe_customer_id")
      .eq("id", companyUserId)
      .single();

    if (error || !companyUser?.stripe_customer_id) {
      console.log("[SEPA] No Stripe customer found for user:", companyUserId);
      return null;
    }

    const customerId = companyUser.stripe_customer_id;

    // 2) ✅ NOUVEAU : Chercher d'abord dans les Setup Intents récents (plus fiable pour SEPA)
    // Les Setup Intents SEPA contiennent souvent le mandate directement
    const setupIntents = await stripe.setupIntents.list({
      customer: customerId,
      limit: 20, // Récupérer les 20 derniers Setup Intents
    });

    // Parcourir les Setup Intents pour trouver un mandate
    for (const si of setupIntents.data) {
      // Vérifier si c'est un Setup Intent SEPA qui a réussi
      if (si.status === "succeeded" && 
          si.payment_method_types.includes("sepa_debit") && 
          si.mandate) {
        const mandateId = si.mandate;
        console.log("[SEPA] Found mandate in Setup Intent:", si.id, "mandate:", mandateId);
        
        try {
          const mandate = await stripe.mandates.retrieve(mandateId);
          console.log("[SEPA] Retrieved mandate from Setup Intent:", mandate.id, "status:", mandate.status);
          
          if (mandate.status === "active" || mandate.status === "pending") {
            // Récupérer le payment method associé pour les détails
            const pmId = si.payment_method;
            let pmDetails = null;
            if (pmId) {
              try {
                const pm = await stripe.paymentMethods.retrieve(pmId);
                pmDetails = pm.sepa_debit;
              } catch (pmError) {
                console.warn("[SEPA] Could not retrieve payment method details:", pmError.message);
              }
            }
            
            return {
              id: mandate.id,
              status: mandate.status,
              type: mandate.type,
              paymentMethodId: pmId,
              customerId: customerId,
              acceptance: mandate.acceptance,
              customer_acceptance: mandate.customer_acceptance,
              details: pmDetails ? {
                bankCode: pmDetails.bank_code,
                branchCode: pmDetails.branch_code,
                last4: pmDetails.last4,
                fingerprint: pmDetails.fingerprint,
                country: pmDetails.country,
              } : null,
            };
          }
        } catch (mandateError) {
          console.error("[SEPA] Error retrieving mandate from Setup Intent:", mandateError.message);
          continue;
        }
      }
    }

    // 3) Fallback : Récupérer TOUS les payment methods SEPA du customer
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "sepa_debit",
      limit: 100, // Limite pour récupérer tous les payment methods
    });

    if (paymentMethods.data.length === 0) {
      console.log("[SEPA] No SEPA payment methods found for customer:", customerId);
      return null;
    }

    // 4) Parcourir TOUS les payment methods SEPA pour trouver un mandate actif
    for (const sepaPaymentMethod of paymentMethods.data) {
      const mandateId = sepaPaymentMethod.sepa_debit?.mandate;

      if (!mandateId) {
        console.log("[SEPA] Payment method", sepaPaymentMethod.id, "has no mandate");
        continue; // Passer au suivant
      }

      try {
        // 4) Récupérer le mandate depuis Stripe
        const mandate = await stripe.mandates.retrieve(mandateId);

        console.log("[SEPA] Retrieved mandate:", mandate.id, "status:", mandate.status);

        // 5) Vérifier que le mandate est actif ou pending
        // "active" = mandate validé et utilisable
        // "pending" = mandate accepté par l'utilisateur mais en attente de validation bancaire (acceptable pour créer des offres)
        if (mandate.status === "active" || mandate.status === "pending") {
          return {
            id: mandate.id,
            status: mandate.status, // "active"
            type: mandate.type, // "sepa_debit"
            paymentMethodId: sepaPaymentMethod.id,
            customerId: customerId,
            // Informations additionnelles du mandate Stripe
            acceptance: mandate.acceptance, // Détails de l'acceptation
            customer_acceptance: mandate.customer_acceptance, // Informations d'acceptation client
            details: {
              bankCode: sepaPaymentMethod.sepa_debit?.bank_code,
              branchCode: sepaPaymentMethod.sepa_debit?.branch_code,
              last4: sepaPaymentMethod.sepa_debit?.last4,
              fingerprint: sepaPaymentMethod.sepa_debit?.fingerprint,
              country: sepaPaymentMethod.sepa_debit?.country,
            },
          };
        } else {
          console.log("[SEPA] Mandate", mandate.id, "is not active, status:", mandate.status);
          // Continuer à chercher dans les autres payment methods
        }
      } catch (mandateError) {
        console.error("[SEPA] Error retrieving mandate", mandateId, ":", mandateError.message);
        // Continuer à chercher dans les autres payment methods
        continue;
      }
    }

    // 7) Aucun mandate actif trouvé
    console.log("[SEPA] No active mandate found for customer:", customerId);
    return null;
  } catch (error) {
    console.error("[SEPA] Error in getSepaMandate:", error);
    // En cas d'erreur, retourner null plutôt que de faire planter l'application
    return null;
  }
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
 * Selon la documentation Stripe :
 * - Un mandate SEPA actif est requis pour créer un Payment Intent avec SEPA
 * - Le payment method doit avoir un mandate associé avec le statut "active"
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
  applicationFeeAmount = null, // Commission NIOS en centimes (optionnel)
  captureMethod = "manual", // "manual" ou "automatic" (par défaut: "manual")
  metadata = {},
}) {
  // 1) ✅ VALIDATION SEPA : Vérifier qu'un mandate SEPA actif existe
  const sepaMandate = await getSepaMandate(companyUserId);
  
  if (!sepaMandate) {
    throw new Error("No active SEPA mandate found. Please set up SEPA Direct Debit first.");
  }
  
  if (sepaMandate.status !== "active") {
    throw new Error(`SEPA mandate is not active. Current status: ${sepaMandate.status}. Please complete the SEPA setup.`);
  }

  // 2) Créer ou récupérer le Stripe Customer
  const customerId = await getOrCreateStripeCustomer(companyUserId);

  // 3) ✅ UTILISER DIRECTEMENT le paymentMethodId et mandateId depuis getSepaMandate
  // getSepaMandate a déjà vérifié que le mandate est actif, donc on peut l'utiliser directement
  let finalPaymentMethodId = paymentMethodId || sepaMandate.paymentMethodId;
  let finalMandateId = sepaMandate.id; // Le mandate ID retourné par getSepaMandate

  // Si paymentMethodId est fourni explicitement, vérifier qu'il correspond au mandate
  if (paymentMethodId && paymentMethodId !== sepaMandate.paymentMethodId) {
    console.warn(`[SEPA] Provided paymentMethodId (${paymentMethodId}) differs from mandate paymentMethodId (${sepaMandate.paymentMethodId}). Using mandate paymentMethodId.`);
    finalPaymentMethodId = sepaMandate.paymentMethodId;
  }

  // Vérifier que le payment method existe
  if (!finalPaymentMethodId) {
    throw new Error("No SEPA payment method found. Please set up SEPA Direct Debit first.");
  }

  // Vérifier que le mandate ID existe
  if (!finalMandateId) {
    throw new Error("No SEPA mandate ID found. Please set up SEPA Direct Debit first.");
  }

  // Vérification finale : s'assurer que le payment method et le mandate sont valides
  try {
    const finalPaymentMethod = await stripe.paymentMethods.retrieve(finalPaymentMethodId);
    console.log(`✅ [SEPA] Payment method ${finalPaymentMethodId} retrieved successfully`);
    
    // ✅ CRUCIAL : Vérifier que le payment method est attaché au customer
    // Pour SEPA avec off_session, le payment method DOIT être attaché au customer
    if (!finalPaymentMethod.customer) {
      console.log(`⚠️ [SEPA] Payment method not attached to customer. Attaching now...`);
      await stripe.paymentMethods.attach(finalPaymentMethodId, {
        customer: customerId,
      });
      console.log(`✅ [SEPA] Payment method attached to customer ${customerId}`);
    } else if (finalPaymentMethod.customer !== customerId) {
      console.warn(`⚠️ [SEPA] Payment method attached to different customer (${finalPaymentMethod.customer}). Re-attaching to ${customerId}...`);
      // Détacher puis réattacher au bon customer
      await stripe.paymentMethods.detach(finalPaymentMethodId);
      await stripe.paymentMethods.attach(finalPaymentMethodId, {
        customer: customerId,
      });
      console.log(`✅ [SEPA] Payment method re-attached to customer ${customerId}`);
    } else {
      console.log(`✅ [SEPA] Payment method already attached to customer ${customerId}`);
    }
    
    // Vérifier que le mandate est toujours actif (double vérification)
    const mandateCheck = await stripe.mandates.retrieve(finalMandateId);
    if (mandateCheck.status !== "active") {
      throw new Error(`SEPA mandate is not active. Current status: ${mandateCheck.status}. Please set up a new SEPA Direct Debit.`);
    }
    console.log(`✅ [SEPA] Mandate ${finalMandateId} is active`);
  } catch (err) {
    console.error(`[SEPA] Error verifying payment method or mandate:`, err.message);
    throw new Error(`Invalid SEPA payment method or mandate: ${err.message}`);
  }

  console.log(`✅ [SEPA] Using payment method ${finalPaymentMethodId} with active mandate ${finalMandateId}`);

  // 5) Créer le Payment Intent avec capture_method configurable
  const paymentIntentPayload = {
    amount: Math.round(amount * 100), // Convertir en centimes
    currency,
    customer: customerId,
    payment_method: finalPaymentMethodId,
    payment_method_types: ["sepa_debit"],
    mandate: finalMandateId, // ✅ CRUCIAL : Spécifier le mandate ID pour SEPA Direct Debit
    capture_method: captureMethod, // "manual" (par défaut) ou "automatic" (capture immédiate)
    off_session: true, // Prélèvement automatique (off-session)
    confirm: true, // Confirmer automatiquement (pour SEPA off-session)
    // ❌ CRUCIAL : Ne PAS définir setup_future_usage avec off_session=true
    // Le mandate SEPA permet déjà les paiements futurs, pas besoin de setup_future_usage
    // Si on définit setup_future_usage, Stripe bloque car incompatible avec off_session
    metadata: {
      userId: companyUserId,
      userRole: "company",
      source: "beldetailing-app",
      mandateId: finalMandateId, // Ajouter l'ID du mandate pour traçabilité
      ...metadata,
    },
  };
  
  // ✅ S'assurer explicitement que setup_future_usage n'est PAS défini
  // (même si Stripe pourrait l'ajouter automatiquement dans certains cas)
  // On ne le définit pas du tout pour éviter tout conflit
  
  // 6) Si un Connected Account est dans les metadata → Utiliser Stripe Connect
  if (metadata.stripeConnectedAccountId) {
    // ✅ Utiliser Stripe Connect : application_fee_amount + transfer_data
    // ⚠️ IMPORTANT : Ne PAS utiliser on_behalf_of avec off_session + confirm
    // Cela peut causer Stripe à ajouter automatiquement setup_future_usage
    // On utilise uniquement application_fee_amount + transfer_data
    
    if (applicationFeeAmount && applicationFeeAmount > 0) {
      // Si applicationFeeAmount > 0 : prélever la commission NIOS directement
      paymentIntentPayload.application_fee_amount = applicationFeeAmount;
      paymentIntentPayload.transfer_data = {
        destination: metadata.stripeConnectedAccountId,
      };
      console.log(`✅ [SEPA] Using Stripe Connect with commission: Connected Account ${metadata.stripeConnectedAccountId}, Application Fee: ${applicationFeeAmount} cents`);
      console.log(`⚠️ [SEPA] NOT using on_behalf_of to avoid setup_future_usage conflict with off_session`);
    } else {
      // Si applicationFeeAmount = 0 ou null : transférer tout le montant au Connected Account (sans commission)
      paymentIntentPayload.transfer_data = {
        destination: metadata.stripeConnectedAccountId,
      };
      console.log(`✅ [SEPA] Using Stripe Connect without commission: Connected Account ${metadata.stripeConnectedAccountId}, Full amount transferred`);
      console.log(`⚠️ [SEPA] NOT using on_behalf_of to avoid setup_future_usage conflict with off_session`);
    }
  } else if (applicationFeeAmount && applicationFeeAmount > 0) {
    // ⚠️ Si applicationFeeAmount est fourni mais pas de Connected Account
    // → La commission sera gérée via un Transfer après capture (fallback)
    console.warn(`⚠️ [SEPA] applicationFeeAmount provided (${applicationFeeAmount} cents) but no Connected Account. Commission will be handled via Transfer after capture.`);
    // Stocker le montant de la commission dans les metadata pour référence
    paymentIntentPayload.metadata.commissionAmount = applicationFeeAmount.toString();
    paymentIntentPayload.metadata.commissionHandling = "transfer_after_capture";
  }
  
  // ✅ CRUCIAL : S'assurer qu'aucun setup_future_usage n'est défini (même implicitement)
  // Supprimer explicitement setup_future_usage si présent (par sécurité)
  if (paymentIntentPayload.setup_future_usage !== undefined) {
    delete paymentIntentPayload.setup_future_usage;
    console.log(`⚠️ [SEPA] Removed setup_future_usage from PaymentIntent (incompatible with off_session)`);
  }
  
  // Log le payload final pour debug (sans les données sensibles)
  console.log(`🔍 [SEPA] PaymentIntent payload:`, {
    amount: paymentIntentPayload.amount,
    currency: paymentIntentPayload.currency,
    payment_method: paymentIntentPayload.payment_method,
    mandate: paymentIntentPayload.mandate,
    off_session: paymentIntentPayload.off_session,
    confirm: paymentIntentPayload.confirm,
    capture_method: paymentIntentPayload.capture_method,
    setup_future_usage: paymentIntentPayload.setup_future_usage, // Devrait être undefined
    on_behalf_of: paymentIntentPayload.on_behalf_of,
    application_fee_amount: paymentIntentPayload.application_fee_amount,
    has_transfer_data: !!paymentIntentPayload.transfer_data,
  });
  
  const paymentIntent = await stripe.paymentIntents.create(paymentIntentPayload);

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
  // 1) Vérifier le statut du Payment Intent AVANT de capturer
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  
  // 2) Vérifier que le Payment Intent est dans un état capturable
  if (paymentIntent.status !== "requires_capture") {
    const errorMessage = `Payment Intent ${paymentIntentId} cannot be captured. Current status: ${paymentIntent.status}. Only PaymentIntents with status "requires_capture" can be captured.`;
    console.error(`❌ [SEPA CAPTURE] ${errorMessage}`);
    throw new Error(errorMessage);
  }
  
  // 3) Vérifier que amount_capturable > 0
  if (paymentIntent.amount_capturable === 0) {
    const errorMessage = `Payment Intent ${paymentIntentId} has no capturable amount (amount_capturable: 0). It may have already been captured.`;
    console.error(`❌ [SEPA CAPTURE] ${errorMessage}`);
    throw new Error(errorMessage);
  }
  
  console.log(`✅ [SEPA CAPTURE] Payment Intent ${paymentIntentId} is ready for capture (status: ${paymentIntent.status}, amount_capturable: ${paymentIntent.amount_capturable})`);
  
  // 4) Capturer le Payment Intent
  const captured = await stripe.paymentIntents.capture(paymentIntentId);

  console.log(`✅ [SEPA CAPTURE] Payment Intent ${paymentIntentId} captured successfully (status: ${captured.status})`);

  return {
    id: captured.id,
    status: captured.status,
    amount: captured.amount / 100,
    currency: captured.currency,
    captured: captured.amount_capturable === 0,
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
