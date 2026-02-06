// src/jobs/retryFailedSepaPayments.js
import cron from "node-cron";
import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * 🔄 CRON JOB : Retry automatique des paiements SEPA échoués
 * 
 * - Tous les 6 heures
 * - Récupère les paiements avec status "failed" et retry_count < 3
 * - Tente de recréer un PaymentIntent SEPA
 * - Incrémente retry_count après chaque tentative
 * - Notifie la company après 3 échecs
 * 
 * Statuts gérés :
 * - failed → authorized (retry réussi)
 * - failed → failed (retry échoué, retry_count++)
 */

let isRunning = false;

/**
 * Retry un paiement SEPA échoué
 */
async function retrySepaPayment(payment) {
  try {
    console.log(`🔄 [RETRY] Attempting to retry payment ${payment.id}...`);

    // Import dynamique
    const { createSepaPaymentIntent } = await import("../services/sepaDirectDebit.service.js");
    const { getMissionAgreementById } = await import("../services/missionAgreement.service.js");
    const { updateMissionPaymentStatus } = await import("../services/missionPayment.service.js");

    // 1) Récupérer le Mission Agreement pour avoir le SEPA customer
    const agreement = await getMissionAgreementById(payment.mission_agreement_id);
    if (!agreement) {
      throw new Error("Mission Agreement not found");
    }

    if (!agreement.stripeSepaCustomerId) {
      throw new Error("No SEPA customer ID in Mission Agreement");
    }

    // 2) Récupérer le mandate SEPA actif
    const { data: mandate, error: mandateError } = await supabase
      .from("sepa_mandates")
      .select("*")
      .eq("company_id", agreement.companyId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (mandateError || !mandate) {
      throw new Error("No active SEPA mandate found for this company");
    }

    // 3) Créer un nouveau PaymentIntent SEPA
    const paymentIntent = await createSepaPaymentIntent({
      amount: payment.amount,
      currency: "eur",
      customerId: agreement.stripeSepaCustomerId,
      paymentMethodId: mandate.stripe_payment_method_id,
      metadata: {
        missionPaymentId: payment.id,
        missionAgreementId: payment.mission_agreement_id,
        type: payment.type,
        retry: true,
        retryCount: (payment.retry_count || 0) + 1,
      },
      confirm: true, // Confirmer immédiatement
    });

    // 4) Mettre à jour le paiement
    await updateMissionPaymentStatus(payment.id, "processing", {
      stripePaymentIntentId: paymentIntent.id,
      retryCount: (payment.retry_count || 0) + 1,
      failureReason: null, // Clear l'erreur précédente
    });

    console.log(`✅ [RETRY] Payment ${payment.id} retry successful (PaymentIntent: ${paymentIntent.id})`);
    
    return { success: true, paymentId: payment.id, paymentIntentId: paymentIntent.id };

  } catch (err) {
    console.error(`❌ [RETRY] Failed to retry payment ${payment.id}:`, err.message);

    // Incrémenter le retry_count
    const newRetryCount = (payment.retry_count || 0) + 1;
    
    await supabase
      .from("mission_payments")
      .update({
        retry_count: newRetryCount,
        failure_reason: err.message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id);

    // Si on a atteint le max de tentatives (3), notifier la company
    if (newRetryCount >= 3) {
      console.error(`🚨 [RETRY] Payment ${payment.id} failed after ${newRetryCount} attempts, notifying company...`);
      
      // TODO : Envoyer notification OneSignal à la company
      // await sendPaymentFailureNotification(agreement.companyId, payment);
    }

    return { success: false, paymentId: payment.id, error: err.message };
  }
}

/**
 * Job principal : retry des paiements SEPA échoués
 */
async function retryFailedPayments() {
  if (isRunning) {
    console.log("⚠️ [RETRY] Previous job still running, skipping...");
    return;
  }

  isRunning = true;
  console.log("🔄 [RETRY] Starting failed SEPA payments retry...");

  try {
    // Récupérer les paiements échoués (retry_count < 3)
    const { data: failedPayments, error } = await supabase
      .from("mission_payments")
      .select("*")
      .eq("status", "failed")
      .lt("retry_count", 3) // Max 3 tentatives
      .order("created_at", { ascending: true }) // Plus anciens d'abord
      .limit(10); // Limiter à 10 par run (éviter surcharge)

    if (error) {
      console.error("❌ [RETRY] Error fetching failed payments:", error);
      return;
    }

    if (!failedPayments || failedPayments.length === 0) {
      console.log("ℹ️ [RETRY] No failed payments to retry");
      return;
    }

    console.log(`ℹ️ [RETRY] Found ${failedPayments.length} failed payment(s) to retry`);

    const results = {
      total: failedPayments.length,
      success: 0,
      failed: 0,
      errors: [],
    };

    // Retry chaque paiement séquentiellement
    for (const payment of failedPayments) {
      const result = await retrySepaPayment(payment);

      if (result.success) {
        results.success++;
      } else {
        results.failed++;
        results.errors.push({
          paymentId: payment.id,
          missionAgreementId: payment.mission_agreement_id,
          retryCount: (payment.retry_count || 0) + 1,
          error: result.error,
        });
      }

      // Pause entre chaque retry (rate limiting)
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`✅ [RETRY] Retry completed:`, {
      total: results.total,
      success: results.success,
      failed: results.failed,
    });

    if (results.failed > 0) {
      console.error(`❌ [RETRY] ${results.failed} payment(s) still failed:`, results.errors);
    }

  } catch (err) {
    console.error("💥 [RETRY] Unexpected error in retry job:", err);
  } finally {
    isRunning = false;
  }
}

/**
 * Configuration du cron
 * - Toutes les 6 heures
 * - Format : "minute hour day month weekday"
 */
export function startSepaRetryJobCron() {
  console.log("✅ [RETRY] SEPA retry job initialized (runs every 6 hours)");
  
  // Toutes les 6 heures (00:00, 06:00, 12:00, 18:00)
  cron.schedule("0 */6 * * *", retryFailedPayments, {
    timezone: "Europe/Brussels",
  });
  
  // ⚠️ POUR TESTS : Décommenter pour exécuter toutes les 10 minutes
  // cron.schedule("*/10 * * * *", retryFailedPayments, {
  //   timezone: "Europe/Brussels",
  // });
}

// Export manuel pour tests
export { retryFailedPayments };
