// src/services/sepaMandateValidation.service.js
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { sendNotificationToUser } from "./onesignal.service.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

/**
 * 🟦 VALIDATE SEPA MANDATE WITH TEST PAYMENT – Valider un mandate SEPA avec un paiement test de 1€
 * 
 * Cette fonction effectue un paiement test de 1€ qui sera immédiatement remboursé.
 * Cela permet de valider le mandate en on-session avant de l'utiliser pour les vrais paiements off-session.
 * 
 * @param {string} companyUserId - ID de la company
 * @param {string} paymentMethodId - ID du payment method SEPA
 * @param {string} mandateId - ID du mandate SEPA
 * @returns {Promise<Object>} Résultat avec paymentIntentId et refundId
 */
export async function validateSepaMandateWithTestPayment(companyUserId, paymentMethodId, mandateId) {
  console.log(`🔄 [SEPA VALIDATION] Starting test payment for mandate validation`);
  console.log(`📦 [SEPA VALIDATION] Company: ${companyUserId}, PaymentMethod: ${paymentMethodId}, Mandate: ${mandateId}`);

  try {
    // 1) Récupérer le Stripe Customer ID
    const { data: companyUser, error: userError } = await supabase
      .from("users")
      .select("stripe_customer_id, email")
      .eq("id", companyUserId)
      .single();

    if (userError || !companyUser?.stripe_customer_id) {
      throw new Error("Company Stripe customer not found");
    }

    const customerId = companyUser.stripe_customer_id;

    // 2) Vérifier que le payment method est attaché au customer
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (!paymentMethod.customer || paymentMethod.customer !== customerId) {
      console.log(`⚠️ [SEPA VALIDATION] Payment method not attached, attaching now...`);
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });
    }

    // 3) Créer un PaymentIntent de 1€ pour valider le mandate (ON-SESSION)
    // ⚠️ IMPORTANT : Pour SEPA, on ne peut pas utiliser confirm: true directement
    // Il faut retourner le client_secret et laisser l'utilisateur confirmer via PaymentSheet
    // OU utiliser off_session: true avec confirm: true (mais Stripe peut bloquer si le mandate n'a jamais été utilisé)
    console.log(`🔄 [SEPA VALIDATION] Creating test PaymentIntent (1€)...`);
    
    // ✅ Essayer d'abord avec off_session: true et confirm: true (pour Postman/automatique)
    // Si ça échoue, on retournera le client_secret pour confirmation manuelle
    let testPaymentIntent;
    let requiresClientConfirmation = false;
    
    try {
      testPaymentIntent = await stripe.paymentIntents.create({
        amount: 100, // 1€ en centimes
        currency: "eur",
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: ["sepa_debit"],
        mandate: mandateId,
        off_session: true, // ✅ Off-session pour permettre confirm: true
        confirm: true, // ✅ Confirmer immédiatement
        description: "Test payment to validate SEPA mandate - will be refunded",
        metadata: {
          userId: companyUserId,
          userRole: "company",
          source: "beldetailing-app",
          type: "sepa_mandate_validation",
          isTestPayment: "true",
          mandateId: mandateId,
        },
      });
      console.log(`✅ [SEPA VALIDATION] PaymentIntent created and confirmed: ${testPaymentIntent.id}`);
    } catch (stripeError) {
      // ❌ Si Stripe bloque (mandate jamais utilisé on-session), créer sans confirm
      console.warn(`⚠️ [SEPA VALIDATION] Direct confirmation failed (${stripeError.message}), creating PaymentIntent without confirm...`);
      
      testPaymentIntent = await stripe.paymentIntents.create({
        amount: 100, // 1€ en centimes
        currency: "eur",
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: ["sepa_debit"],
        mandate: mandateId,
        off_session: false, // ✅ ON-SESSION - nécessite confirmation via PaymentSheet
        confirm: false, // ❌ Ne pas confirmer automatiquement
        description: "Test payment to validate SEPA mandate - will be refunded",
        metadata: {
          userId: companyUserId,
          userRole: "company",
          source: "beldetailing-app",
          type: "sepa_mandate_validation",
          isTestPayment: "true",
          mandateId: mandateId,
        },
      });
      
      requiresClientConfirmation = true;
      console.log(`✅ [SEPA VALIDATION] PaymentIntent created (requires client confirmation): ${testPaymentIntent.id}`);
    }

    console.log(`✅ [SEPA VALIDATION] Test PaymentIntent created: ${testPaymentIntent.id}, status: ${testPaymentIntent.status}`);

    // 4) Pour SEPA, le PaymentIntent sera en "processing" puis "succeeded" après 2-5 jours
    // On ne peut pas attendre, donc on va :
    // - Si succeeded immédiatement → rembourser maintenant
    // - Sinon → rembourser via webhook quand il sera succeeded

    let refundId = null;

    if (testPaymentIntent.status === "succeeded") {
      // ✅ Paiement succeeded immédiatement → rembourser maintenant
      console.log(`🔄 [SEPA VALIDATION] PaymentIntent succeeded immediately, creating refund...`);
      
      const refund = await stripe.refunds.create({
        payment_intent: testPaymentIntent.id,
        reason: "requested_by_customer",
        metadata: {
          userId: companyUserId,
          type: "sepa_mandate_validation_refund",
          originalPaymentIntent: testPaymentIntent.id,
        },
      });

      refundId = refund.id;
      console.log(`✅ [SEPA VALIDATION] Refund created: ${refundId}`);
    } else if (testPaymentIntent.status === "processing") {
      // ✅ SEPA en processing → le remboursement sera fait via webhook quand succeeded
      console.log(`⏳ [SEPA VALIDATION] PaymentIntent is processing (SEPA - 2-5 days). Refund will be processed automatically when payment succeeds.`);
      
      // ✅ Pas besoin de table supplémentaire - les metadata du PaymentIntent contiennent toutes les infos
      // Le webhook vérifiera les metadata pour savoir si c'est un paiement de validation
    } else {
      console.warn(`⚠️ [SEPA VALIDATION] PaymentIntent in unexpected status: ${testPaymentIntent.status}`);
    }

    // 5) Envoyer une notification à l'utilisateur
    try {
      await sendNotificationToUser({
        userId: companyUserId,
        title: "Validation du mandat SEPA",
        message: "Un paiement test de 1€ a été effectué pour valider votre mandat SEPA. Ce montant sera remboursé automatiquement dans les prochains jours.",
        data: {
          type: "sepa_mandate_validation",
          payment_intent_id: testPaymentIntent.id,
          refund_id: refundId,
          mandate_id: mandateId,
        },
      });
    } catch (notifError) {
      console.error(`⚠️ [SEPA VALIDATION] Notification send failed:`, notifError);
    }

    // ✅ Si le PaymentIntent nécessite une confirmation client, retourner le client_secret
    if (requiresClientConfirmation) {
      return {
        paymentIntentId: testPaymentIntent.id,
        clientSecret: testPaymentIntent.client_secret,
        requiresClientConfirmation: true,
        status: testPaymentIntent.status,
        message: "PaymentIntent created. Please confirm it using PaymentSheet with the provided client_secret to validate your SEPA mandate.",
      };
    }

    return {
      paymentIntentId: testPaymentIntent.id,
      refundId: refundId,
      status: testPaymentIntent.status,
      requiresClientConfirmation: false,
      message: testPaymentIntent.status === "succeeded"
        ? "Test payment succeeded and refunded immediately"
        : "Test payment is processing (SEPA - 2-5 days). Refund will be processed automatically when payment succeeds.",
    };

  } catch (error) {
    console.error(`❌ [SEPA VALIDATION] Error validating mandate:`, error);
    throw error;
  }
}

/**
 * 🟦 REFUND SEPA VALIDATION PAYMENT – Rembourser un paiement de validation SEPA
 * 
 * Cette fonction est appelée par le webhook quand le PaymentIntent de validation est succeeded.
 * 
 * @param {string} paymentIntentId - ID du PaymentIntent de validation
 * @returns {Promise<Object>} Résultat du remboursement
 */
export async function refundSepaValidationPayment(paymentIntentId) {
  console.log(`🔄 [SEPA VALIDATION] Refunding validation payment: ${paymentIntentId}`);

  try {
    // 1) Vérifier le statut du PaymentIntent et ses metadata
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    // Vérifier que c'est bien un paiement de validation
    if (paymentIntent.metadata?.type !== "sepa_mandate_validation" || 
        paymentIntent.metadata?.isTestPayment !== "true") {
      console.log(`ℹ️ [SEPA VALIDATION] Payment ${paymentIntentId} is not a validation payment`);
      return { notValidationPayment: true };
    }
    
    // Vérifier si déjà remboursé (en cherchant les refunds)
    const refunds = await stripe.refunds.list({
      payment_intent: paymentIntentId,
      limit: 10,
    });
    
    if (refunds.data.length > 0) {
      console.log(`ℹ️ [SEPA VALIDATION] Payment ${paymentIntentId} already refunded: ${refunds.data[0].id}`);
      return { alreadyRefunded: true, refundId: refunds.data[0].id };
    }
    
    if (paymentIntent.status !== "succeeded") {
      console.log(`⏳ [SEPA VALIDATION] PaymentIntent ${paymentIntentId} not yet succeeded (status: ${paymentIntent.status})`);
      return { waiting: true, status: paymentIntent.status };
    }

    // 2) Créer le remboursement
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
      metadata: {
        userId: paymentIntent.metadata?.userId || null,
        type: "sepa_mandate_validation_refund",
        originalPaymentIntent: paymentIntentId,
      },
    });

    console.log(`✅ [SEPA VALIDATION] Refund created: ${refund.id}`);

    // 3) Envoyer une notification à l'utilisateur
    const userId = paymentIntent.metadata?.userId;
    if (userId) {
      try {
        await sendNotificationToUser({
          userId: userId,
          title: "Remboursement du paiement test",
          message: "Le paiement test de 1€ pour valider votre mandat SEPA a été remboursé. Votre mandat est maintenant validé et vous pouvez créer des offres.",
          data: {
            type: "sepa_mandate_validation_refunded",
            payment_intent_id: paymentIntentId,
            refund_id: refund.id,
          },
        });
      } catch (notifError) {
        console.error(`⚠️ [SEPA VALIDATION] Notification send failed:`, notifError);
      }
    }

    return {
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount / 100,
    };

  } catch (error) {
    console.error(`❌ [SEPA VALIDATION] Error refunding validation payment:`, error);
    throw error;
  }
}

/**
 * 🟦 CHECK IF VALIDATION NEEDED – Vérifier si un compte a besoin de validation 1€
 * 
 * Cette fonction vérifie si un compte company avec SEPA setup a déjà fait la validation 1€.
 * Elle cherche dans Stripe si un PaymentIntent de validation existe pour ce customer.
 * 
 * @param {string} companyUserId - ID de la company
 * @returns {Promise<Object>} { needsValidation: boolean, hasActiveMandate: boolean, mandate: object|null }
 */
export async function checkIfSepaValidationNeeded(companyUserId) {
  console.log(`🔄 [SEPA VALIDATION] Checking if validation needed for company: ${companyUserId}`);

  try {
    // 1) Récupérer le Stripe Customer ID
    const { data: companyUser, error: userError } = await supabase
      .from("users")
      .select("stripe_customer_id, email")
      .eq("id", companyUserId)
      .single();

    if (userError || !companyUser?.stripe_customer_id) {
      console.log(`ℹ️ [SEPA VALIDATION] No Stripe customer found for company: ${companyUserId}`);
      return {
        needsValidation: false,
        hasActiveMandate: false,
        mandate: null,
        reason: "no_stripe_customer",
      };
    }

    const customerId = companyUser.stripe_customer_id;

    // 2) Vérifier si un PaymentIntent de validation existe déjà
    const validationPaymentIntents = await stripe.paymentIntents.list({
      customer: customerId,
      limit: 100,
    });

    const hasValidationPayment = validationPaymentIntents.data.some(
      (pi) =>
        pi.metadata?.type === "sepa_mandate_validation" &&
        pi.metadata?.isTestPayment === "true"
    );

    if (hasValidationPayment) {
      console.log(`✅ [SEPA VALIDATION] Validation payment already exists for company: ${companyUserId}`);
      return {
        needsValidation: false,
        hasActiveMandate: true,
        mandate: null,
        reason: "already_validated",
      };
    }

    // 3) Vérifier si un mandate SEPA actif existe
    const { getSepaMandate } = await import("./sepaDirectDebit.service.js");
    const mandate = await getSepaMandate(companyUserId);

    if (!mandate || (mandate.status !== "active" && mandate.status !== "pending")) {
      console.log(`ℹ️ [SEPA VALIDATION] No active SEPA mandate found for company: ${companyUserId}`);
      return {
        needsValidation: false,
        hasActiveMandate: false,
        mandate: null,
        reason: "no_active_mandate",
      };
    }

    // 4) Si un mandate actif existe mais pas de validation → besoin de validation
    console.log(`⚠️ [SEPA VALIDATION] Active mandate found but no validation payment. Validation needed for company: ${companyUserId}`);
    return {
      needsValidation: true,
      hasActiveMandate: true,
      mandate: mandate,
      reason: "mandate_exists_but_not_validated",
    };

  } catch (error) {
    console.error(`❌ [SEPA VALIDATION] Error checking validation status:`, error);
    throw error;
  }
}

/**
 * 🟦 CONFIRM VALIDATION PAYMENT INTENT – Confirmer un PaymentIntent de validation
 * 
 * Cette fonction confirme un PaymentIntent de validation qui nécessite une confirmation client.
 * 
 * @param {string} paymentIntentId - ID du PaymentIntent
 * @param {string} companyUserId - ID de la company (pour vérification)
 * @returns {Promise<Object>} Résultat de la confirmation
 */
export async function confirmValidationPaymentIntent(paymentIntentId, companyUserId) {
  console.log(`🔄 [SEPA VALIDATION] Confirming validation PaymentIntent: ${paymentIntentId}`);

  try {
    // 1) Vérifier que le PaymentIntent existe et appartient à cette company
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.metadata?.userId !== companyUserId) {
      throw new Error("PaymentIntent does not belong to this company");
    }
    
    if (paymentIntent.metadata?.type !== "sepa_mandate_validation") {
      throw new Error("PaymentIntent is not a validation payment");
    }

    // 2) Confirmer le PaymentIntent
    const confirmed = await stripe.paymentIntents.confirm(paymentIntentId);

    console.log(`✅ [SEPA VALIDATION] PaymentIntent confirmed: ${confirmed.id}, status: ${confirmed.status}`);

    return {
      paymentIntentId: confirmed.id,
      status: confirmed.status,
      message: confirmed.status === "succeeded"
        ? "Validation payment succeeded"
        : confirmed.status === "processing"
        ? "Validation payment is processing (SEPA - 2-5 days). Refund will be processed automatically when payment succeeds."
        : `Validation payment status: ${confirmed.status}`,
    };

  } catch (error) {
    console.error(`❌ [SEPA VALIDATION] Error confirming validation PaymentIntent:`, error);
    throw error;
  }
}

/**
 * 🟦 VALIDATE EXISTING ACCOUNT – Valider un compte existant qui n'a pas fait la validation 1€
 * 
 * Cette fonction déclenche la validation 1€ pour un compte existant qui a déjà un SEPA setup
 * mais qui n'a pas encore fait la validation.
 * 
 * @param {string} companyUserId - ID de la company
 * @returns {Promise<Object>} Résultat de la validation
 */
export async function validateExistingSepaAccount(companyUserId) {
  console.log(`🔄 [SEPA VALIDATION] Validating existing account for company: ${companyUserId}`);

  try {
    // 1) Vérifier si la validation est nécessaire
    const checkResult = await checkIfSepaValidationNeeded(companyUserId);

    if (!checkResult.needsValidation) {
      return {
        success: false,
        message: checkResult.reason === "already_validated"
          ? "Account already validated"
          : checkResult.reason === "no_active_mandate"
          ? "No active SEPA mandate found. Please set up SEPA first."
          : "Validation not needed",
        reason: checkResult.reason,
      };
    }

    if (!checkResult.mandate) {
      throw new Error("No active mandate found for validation");
    }

    // 2) Déclencher la validation avec le mandate existant
    const validationResult = await validateSepaMandateWithTestPayment(
      companyUserId,
      checkResult.mandate.paymentMethodId,
      checkResult.mandate.id
    );

    return {
      success: true,
      message: "Validation payment created successfully",
      ...validationResult,
    };

  } catch (error) {
    console.error(`❌ [SEPA VALIDATION] Error validating existing account:`, error);
    throw error;
  }
}
