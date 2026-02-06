// src/jobs/captureMissionPayments.js
import cron from "node-cron";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { withCronLock } from "../utils/cronLock.js";

/**
 * 🔄 CRON JOB : Capture automatique des paiements mensuels programmés
 * 
 * - Tous les jours à 9h (Europe/Brussels)
 * - Récupère les paiements avec status "authorized" et scheduled_date <= aujourd'hui
 * - Capture chaque paiement via Stripe
 * - Enregistre les échecs pour retry ultérieur
 * 
 * Statuts gérés :
 * - authorized → processing (SEPA envoyé)
 * - authorized → captured (Card immédiat)
 */

let isRunning = false;

/**
 * Capturer un paiement mission via Stripe
 */
async function captureMissionPayment(paymentId) {
  try {
    // Import dynamique pour éviter les dépendances circulaires
    const { captureMissionPayment: captureService } = await import("../services/missionPaymentStripe.service.js");
    
    console.log(`🔄 [CRON] Attempting to capture payment ${paymentId}...`);
    
    const result = await captureService(paymentId);
    
    console.log(`✅ [CRON] Payment ${paymentId} captured successfully`, result);
    return { success: true, paymentId, result };
    
  } catch (err) {
    console.error(`❌ [CRON] Failed to capture payment ${paymentId}:`, err.message);
    
    // Enregistrer l'échec dans la table mission_payments (retry_count + failure_reason)
    const { error: updateError } = await supabase
      .from("mission_payments")
      .update({
        status: "failed",
        failure_reason: err.message,
        failed_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
    
    if (updateError) {
      console.error(`❌ [CRON] Could not update failed payment ${paymentId}:`, updateError);
    }
    
    return { success: false, paymentId, error: err.message };
  }
}

/**
 * Job principal : capture des paiements programmés
 */
async function captureScheduledPayments() {
  if (isRunning) {
    console.log("⚠️ [CRON] Previous job still running, skipping...");
    return;
  }

  isRunning = true;
  console.log("🔄 [CRON] Starting scheduled mission payments capture...");

  try {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    
    // Récupérer tous les paiements authorized dont la date est passée
    const { data: payments, error } = await supabase
      .from("mission_payments")
      .select("*")
      .eq("status", "authorized")
      .lte("scheduled_date", today)
      .order("scheduled_date", { ascending: true });

    if (error) {
      console.error("❌ [CRON] Error fetching scheduled payments:", error);
      return;
    }

    if (!payments || payments.length === 0) {
      console.log("ℹ️ [CRON] No scheduled payments to capture today");
      return;
    }

    console.log(`ℹ️ [CRON] Found ${payments.length} payment(s) to capture`);

    const results = {
      total: payments.length,
      success: 0,
      failed: 0,
      errors: [],
    };

    // Capturer chaque paiement séquentiellement (éviter de surcharger Stripe)
    for (const payment of payments) {
      const result = await captureMissionPayment(payment.id);
      
      if (result.success) {
        results.success++;
      } else {
        results.failed++;
        results.errors.push({
          paymentId: payment.id,
          missionAgreementId: payment.mission_agreement_id,
          error: result.error,
        });
      }

      // Petite pause entre chaque capture (rate limiting)
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`✅ [CRON] Capture completed:`, {
      total: results.total,
      success: results.success,
      failed: results.failed,
    });

    if (results.failed > 0) {
      console.error(`❌ [CRON] ${results.failed} payment(s) failed:`, results.errors);
    }

  } catch (err) {
    console.error("💥 [CRON] Unexpected error in capture job:", err);
  } finally {
    isRunning = false;
  }
}

/**
 * Configuration du cron
 * - Tous les jours à 9h (Europe/Brussels)
 * - Format : "minute hour day month weekday"
 * - 🛡️ SÉCURITÉ : Verrou DB pour éviter double exécution en multi-instances
 */
export function startMissionPaymentsCron() {
  console.log("✅ [CRON] Mission payments capture job initialized (runs daily at 9:00 AM)");
  
  // Tous les jours à 9h avec verrou DB
  cron.schedule("0 9 * * *", async () => {
    await withCronLock("capture-mission-payments", captureScheduledPayments, 600); // TTL 10min
  }, {
    timezone: "Europe/Brussels",
  });
  
  // ⚠️ POUR TESTS : Décommenter pour exécuter toutes les 5 minutes
  // cron.schedule("*/5 * * * *", async () => {
  //   await withCronLock("capture-mission-payments", captureScheduledPayments, 600);
  // }, {
  //   timezone: "Europe/Brussels",
  // });
}

// Export manuel pour tests
export { captureScheduledPayments };
