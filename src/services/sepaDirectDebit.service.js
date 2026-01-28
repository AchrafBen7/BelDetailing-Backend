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
  // ⚠️ CRUCIAL : TOUJOURS utiliser le paymentMethodId retourné par getSepaMandate car il est garanti d'avoir le mandate associé
  // Si un paymentMethodId est fourni explicitement, on le vérifie d'abord, sinon on utilise celui de getSepaMandate
  let finalPaymentMethodId = paymentMethodId || sepaMandate.paymentMethodId;
  let finalMandateId = sepaMandate.id; // Le mandate ID retourné par getSepaMandate
  
  // ✅ Vérifier que le paymentMethodId fourni a bien le mandate associé
  if (paymentMethodId && paymentMethodId !== sepaMandate.paymentMethodId) {
    // Vérifier si le payment_method fourni a le bon mandate
    try {
      const providedPM = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (providedPM.sepa_debit?.mandate === finalMandateId) {
        console.log(`✅ [SEPA] Provided paymentMethodId (${paymentMethodId}) has correct mandate (${finalMandateId})`);
        finalPaymentMethodId = paymentMethodId;
      } else {
        console.warn(`⚠️ [SEPA] Provided paymentMethodId (${paymentMethodId}) does not have the expected mandate (${finalMandateId}). Using mandate paymentMethodId (${sepaMandate.paymentMethodId}) instead.`);
        finalPaymentMethodId = sepaMandate.paymentMethodId; // ✅ Utiliser celui qui a le mandate
      }
    } catch (pmError) {
      console.warn(`⚠️ [SEPA] Could not verify provided paymentMethodId (${paymentMethodId}): ${pmError.message}. Using mandate paymentMethodId (${sepaMandate.paymentMethodId}) instead.`);
      finalPaymentMethodId = sepaMandate.paymentMethodId; // ✅ Utiliser celui qui a le mandate
    }
  } else {
    // Pas de paymentMethodId fourni ou c'est celui de getSepaMandate → utiliser celui de getSepaMandate
    finalPaymentMethodId = sepaMandate.paymentMethodId;
    console.log(`✅ [SEPA] Using paymentMethodId from getSepaMandate: ${finalPaymentMethodId} (guaranteed to have mandate ${finalMandateId})`);
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
    console.log(`🔍 [SEPA] Payment method details:`, {
      id: finalPaymentMethod.id,
      type: finalPaymentMethod.type,
      customer: finalPaymentMethod.customer,
      sepaDebit: finalPaymentMethod.sepa_debit ? {
        last4: finalPaymentMethod.sepa_debit.last4,
        mandate: finalPaymentMethod.sepa_debit.mandate,
      } : null,
    });
    
    // ✅ CRUCIAL : Vérifier que le payment method est attaché au customer
    // Pour SEPA avec off_session, le payment method DOIT être attaché au customer
    // ⚠️ Si le payment method n'est pas attaché, Stripe retournera payment_method: null dans le PaymentIntent
    if (!finalPaymentMethod.customer) {
      console.log(`⚠️ [SEPA] Payment method not attached to customer. Attaching now...`);
      await stripe.paymentMethods.attach(finalPaymentMethodId, {
        customer: customerId,
      });
      console.log(`✅ [SEPA] Payment method attached to customer ${customerId}`);
      
      // ✅ Vérifier après attachement que le payment method est bien attaché
      const recheckPaymentMethod = await stripe.paymentMethods.retrieve(finalPaymentMethodId);
      if (!recheckPaymentMethod.customer || recheckPaymentMethod.customer !== customerId) {
        throw new Error(`Failed to attach payment method ${finalPaymentMethodId} to customer ${customerId}`);
      }
      console.log(`✅ [SEPA] Payment method attachment verified: customer = ${recheckPaymentMethod.customer}`);
    } else if (finalPaymentMethod.customer !== customerId) {
      console.warn(`⚠️ [SEPA] Payment method attached to different customer (${finalPaymentMethod.customer}). Re-attaching to ${customerId}...`);
      // Détacher puis réattacher au bon customer
      await stripe.paymentMethods.detach(finalPaymentMethodId);
      await stripe.paymentMethods.attach(finalPaymentMethodId, {
        customer: customerId,
      });
      console.log(`✅ [SEPA] Payment method re-attached to customer ${customerId}`);
      
      // ✅ Vérifier après réattachement
      const recheckPaymentMethod = await stripe.paymentMethods.retrieve(finalPaymentMethodId);
      if (!recheckPaymentMethod.customer || recheckPaymentMethod.customer !== customerId) {
        throw new Error(`Failed to re-attach payment method ${finalPaymentMethodId} to customer ${customerId}`);
      }
      console.log(`✅ [SEPA] Payment method re-attachment verified: customer = ${recheckPaymentMethod.customer}`);
    } else {
      console.log(`✅ [SEPA] Payment method already attached to customer ${customerId}`);
    }
    
    // ✅ Vérifier que le mandate est toujours actif (double vérification)
    const mandateCheck = await stripe.mandates.retrieve(finalMandateId);
    if (mandateCheck.status !== "active") {
      throw new Error(`SEPA mandate is not active. Current status: ${mandateCheck.status}. Please set up a new SEPA Direct Debit.`);
    }
    console.log(`✅ [SEPA] Mandate ${finalMandateId} is active`);
    
    // ✅ Vérifier que le payment method a bien le mandate associé
    // ⚠️ IMPORTANT : Pour SEPA, le mandate peut être associé via le SetupIntent plutôt que directement dans sepa_debit.mandate
    // Si le payment method vient de getSepaMandate et que le mandate est actif, on peut l'utiliser même si sepa_debit.mandate est undefined
    const paymentMethodHasMandate = finalPaymentMethod.sepa_debit?.mandate === finalMandateId;
    const paymentMethodFromGetSepaMandate = sepaMandate.paymentMethodId === finalPaymentMethodId;
    
    if (!paymentMethodHasMandate) {
      console.warn(`⚠️ [SEPA] Payment method mandate (${finalPaymentMethod.sepa_debit?.mandate || 'undefined'}) differs from expected mandate (${finalMandateId})`);
      
      // ✅ Si le payment method vient de getSepaMandate et que le mandate est actif, on accepte quand même
      // Le mandate sera passé directement dans le PaymentIntent et Stripe l'utilisera
      if (paymentMethodFromGetSepaMandate && mandateCheck.status === "active") {
        console.log(`✅ [SEPA] Payment method from getSepaMandate - mandate will be passed directly in PaymentIntent`);
        console.log(`✅ [SEPA] Mandate ${finalMandateId} is active, payment method ${finalPaymentMethodId} can be used`);
      } else if (sepaMandate.paymentMethodId && sepaMandate.paymentMethodId !== finalPaymentMethodId) {
        // ✅ Essayer avec le payment method retourné par getSepaMandate
        console.log(`🔄 [SEPA] Switching to payment method from getSepaMandate: ${sepaMandate.paymentMethodId}`);
        finalPaymentMethodId = sepaMandate.paymentMethodId;
        
        // Re-récupérer le payment method
        const correctPaymentMethod = await stripe.paymentMethods.retrieve(finalPaymentMethodId);
        finalPaymentMethod = correctPaymentMethod;
        
        // Vérifier que le nouveau payment method est attaché au customer
        if (!correctPaymentMethod.customer || correctPaymentMethod.customer !== customerId) {
          console.log(`⚠️ [SEPA] Payment method not attached to customer. Attaching now...`);
          await stripe.paymentMethods.attach(finalPaymentMethodId, {
            customer: customerId,
          });
          console.log(`✅ [SEPA] Payment method attached to customer ${customerId}`);
        }
        
        // Si ce payment method a le mandate, c'est parfait
        if (correctPaymentMethod.sepa_debit?.mandate === finalMandateId) {
          console.log(`✅ [SEPA] Payment method ${finalPaymentMethodId} has correct mandate ${finalMandateId}`);
        } else {
          // Même si pas de mandate dans sepa_debit.mandate, si le mandate est actif, on peut l'utiliser
          console.log(`✅ [SEPA] Payment method ${finalPaymentMethodId} from getSepaMandate - mandate will be passed in PaymentIntent`);
        }
      } else {
        // Le payment_method n'a pas le bon mandate et on n'a pas d'alternative
        // Mais si le mandate est actif, on peut quand même essayer (le mandate sera passé dans le PaymentIntent)
        if (mandateCheck.status === "active") {
          console.log(`⚠️ [SEPA] Payment method ${finalPaymentMethodId} doesn't have mandate in sepa_debit.mandate, but mandate ${finalMandateId} is active`);
          console.log(`✅ [SEPA] Will pass mandate directly in PaymentIntent - this should work for SEPA`);
        } else {
          throw new Error(`Payment method ${finalPaymentMethodId} does not have the expected mandate ${finalMandateId} and mandate is not active. Please set up a new SEPA Direct Debit.`);
        }
      }
    } else {
      console.log(`✅ [SEPA] Payment method has correct mandate: ${finalMandateId}`);
    }
    
  } catch (err) {
    console.error(`[SEPA] Error verifying payment method or mandate:`, err.message);
    console.error(`[SEPA] Error details:`, {
      message: err.message,
      type: err.type,
      code: err.code,
      statusCode: err.statusCode,
    });
    throw new Error(`Invalid SEPA payment method or mandate: ${err.message}`);
  }

  console.log(`✅ [SEPA] Using payment method ${finalPaymentMethodId} with active mandate ${finalMandateId}`);
  console.log(`🔍 [SEPA] Final verification: payment_method=${finalPaymentMethodId}, customer=${customerId}, mandate=${finalMandateId}`);

  // 5) ✅ SEPA ASYNCHRONE : Créer le Payment Intent SANS capture_method
  // ⚠️ IMPORTANT : SEPA n'a PAS besoin de capture_method (c'est automatique et asynchrone)
  // Le PaymentIntent sera en "processing" initialement (NORMAL pour SEPA)
  // Le statut sera mis à jour via webhooks : processing → succeeded (2-5 jours)
  // 
  // ✅ CRUCIAL : Le payment_method DOIT être attaché au customer AVANT de créer le PaymentIntent
  // Sinon Stripe retournera payment_method: null et le PaymentIntent sera en requires_payment_method
  const paymentIntentPayload = {
    amount: Math.round(amount * 100), // Convertir en centimes
    currency,
    customer: customerId,
    payment_method: finalPaymentMethodId, // ✅ CRUCIAL : Payment method DOIT être fourni ET attaché au customer
    payment_method_types: ["sepa_debit"],
    mandate: finalMandateId, // ✅ CRUCIAL : Spécifier le mandate ID pour SEPA Direct Debit
    // ❌ PAS de capture_method pour SEPA - c'est automatique et asynchrone
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
  
  // 6) ✅ FIX SEPA : Ne PAS utiliser transfer_data + application_fee_amount avec SEPA Direct Debit
  // ⚠️ IMPORTANT : Avec SEPA Direct Debit, l'utilisation de transfer_data + application_fee_amount
  // cause une erreur Stripe "unexpected error" car SEPA est asynchrone et Stripe est très sensible
  // aux flows Connect avec destination charges.
  // 
  // Solution : Séparer la charge et le transfert
  // - Créer le PaymentIntent sur la plateforme (sans transfer_data, sans application_fee_amount)
  // - Créer un Transfer séparé vers le Connected Account après que le paiement soit succeeded
  // 
  // Si un Connected Account est dans les metadata, on le stocke pour référence mais on ne l'utilise pas
  // dans le PaymentIntent (le Transfer sera créé séparément)
  if (metadata.stripeConnectedAccountId) {
    console.log(`ℹ️ [SEPA] Connected Account found in metadata: ${metadata.stripeConnectedAccountId}`);
    console.log(`ℹ️ [SEPA] Transfer will be created separately after payment succeeded (SEPA fix)`);
    // Stocker le Connected Account ID dans les metadata pour référence ultérieure
    paymentIntentPayload.metadata.stripeConnectedAccountId = metadata.stripeConnectedAccountId;
  }
  
  if (applicationFeeAmount && applicationFeeAmount > 0) {
    console.warn(`⚠️ [SEPA] applicationFeeAmount provided (${applicationFeeAmount} cents) but not used with SEPA Direct Debit`);
    console.warn(`⚠️ [SEPA] Commission will be handled separately (stays on platform or via Transfer)`);
    // Stocker le montant de la commission dans les metadata pour référence
    paymentIntentPayload.metadata.commissionAmount = applicationFeeAmount.toString();
    paymentIntentPayload.metadata.commissionHandling = "platform_or_separate_transfer";
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
    customer: paymentIntentPayload.customer,
    payment_method: paymentIntentPayload.payment_method,
    mandate: paymentIntentPayload.mandate,
    off_session: paymentIntentPayload.off_session,
    confirm: paymentIntentPayload.confirm,
    capture_method: paymentIntentPayload.capture_method, // Devrait être undefined pour SEPA
    setup_future_usage: paymentIntentPayload.setup_future_usage, // Devrait être undefined
    on_behalf_of: paymentIntentPayload.on_behalf_of,
    application_fee_amount: paymentIntentPayload.application_fee_amount,
    has_transfer_data: !!paymentIntentPayload.transfer_data,
  });
  
  // ✅ CRUCIAL : Vérifier une dernière fois que le payment_method est bien attaché
  try {
    const finalCheck = await stripe.paymentMethods.retrieve(finalPaymentMethodId);
    if (!finalCheck.customer || finalCheck.customer !== customerId) {
      throw new Error(`Payment method ${finalPaymentMethodId} is not attached to customer ${customerId}. Cannot create PaymentIntent.`);
    }
    console.log(`✅ [SEPA] Final check passed: payment_method ${finalPaymentMethodId} is attached to customer ${customerId}`);
  } catch (checkError) {
    console.error(`❌ [SEPA] Final check failed:`, checkError.message);
    throw new Error(`Payment method verification failed: ${checkError.message}`);
  }
  
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(paymentIntentPayload);
  } catch (createError) {
    // ✅ Gestion spécifique des erreurs Stripe
    if (createError.statusCode === 402 || createError.type === "StripeInvalidRequestError") {
      const errorMessage = createError.raw?.message || createError.message;
      console.error(`❌ [SEPA] PaymentIntent creation failed (402/InvalidRequest):`, errorMessage);
      console.error(`❌ [SEPA] PaymentIntent error details:`, {
        statusCode: createError.statusCode,
        type: createError.type,
        code: createError.code,
        paymentIntentId: createError.raw?.payment_intent?.id,
        paymentIntentStatus: createError.raw?.payment_intent?.status,
        lastPaymentError: createError.raw?.payment_intent?.last_payment_error,
      });
      
      // Si le PaymentIntent a été créé mais avec une erreur
      if (createError.raw?.payment_intent) {
        const failedPI = createError.raw.payment_intent;
        if (failedPI.status === "requires_payment_method" && !failedPI.payment_method) {
          throw new Error(
            `SEPA payment failed: Payment method was not accepted by Stripe. ` +
            `This can happen if the payment method does not have a valid mandate or if Stripe's risk system blocks it. ` +
            `Please verify your SEPA Direct Debit setup or try with a smaller amount. ` +
            `Stripe error: ${errorMessage}`
          );
        }
      }
      
      throw new Error(
        `SEPA payment was blocked by Stripe: ${errorMessage}. ` +
        `This can happen with high amounts, first-time SEPA payments, or if the mandate is not properly set up. ` +
        `Please try with a smaller amount or contact support.`
      );
    }
    
    // Autres erreurs
    throw createError;
  }
  
  // ✅ Vérifier que le PaymentIntent a bien un payment_method (pas null)
  if (!paymentIntent.payment_method) {
    console.error(`❌ [SEPA] PaymentIntent created but payment_method is null! PaymentIntent:`, paymentIntent.id);
    console.error(`❌ [SEPA] PaymentIntent status:`, paymentIntent.status);
    console.error(`❌ [SEPA] PaymentIntent last_payment_error:`, paymentIntent.last_payment_error);
    
    throw new Error(
      `PaymentIntent created but payment_method is null. ` +
      `This usually means the payment method was not accepted by Stripe. ` +
      `Please verify your SEPA Direct Debit setup. ` +
      `PaymentIntent status: ${paymentIntent.status}`
    );
  }
  
  // ✅ Vérifier le statut du PaymentIntent
  if (paymentIntent.status === "requires_payment_method") {
    const errorMsg = paymentIntent.last_payment_error?.message || "Payment method required";
    console.error(`❌ [SEPA] PaymentIntent requires_payment_method:`, errorMsg);
    throw new Error(
      `SEPA payment requires a valid payment method: ${errorMsg}. ` +
      `Please verify your SEPA Direct Debit setup.`
    );
  }
  
  console.log(`✅ [SEPA] PaymentIntent created successfully: ${paymentIntent.id}, payment_method: ${paymentIntent.payment_method}, status: ${paymentIntent.status}`);

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
