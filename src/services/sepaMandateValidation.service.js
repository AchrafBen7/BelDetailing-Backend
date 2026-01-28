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
    // ⚠️ IMPORTANT : On utilise confirm: true pour que ce soit un paiement on-session
    // Cela valide le mandate et permet ensuite les paiements off-session
    console.log(`🔄 [SEPA VALIDATION] Creating test PaymentIntent (1€)...`);
    
    const testPaymentIntent = await stripe.paymentIntents.create({
      amount: 100, // 1€ en centimes
      currency: "eur",
      customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: ["sepa_debit"],
      mandate: mandateId,
      off_session: false, // ✅ ON-SESSION pour valider le mandate
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

    return {
      paymentIntentId: testPaymentIntent.id,
      refundId: refundId,
      status: testPaymentIntent.status,
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
