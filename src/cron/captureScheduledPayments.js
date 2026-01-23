// src/cron/captureScheduledPayments.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { captureMissionPayment } from "../services/missionPaymentStripe.service.js";
import { sendNotificationWithDeepLink } from "../services/onesignal.service.js";

/**
 * 🟦 CAPTURE SCHEDULED PAYMENTS – Capturer automatiquement les paiements programmés à leur date d'échéance
 * 
 * Cette fonction est appelée par un cron job (ex: toutes les heures) pour capturer
 * les paiements de mission qui sont autorisés et dont la date d'échéance est arrivée.
 * 
 * @param {string|null} date - Date au format YYYY-MM-DD (optionnel, défaut: aujourd'hui)
 * @returns {Promise<Object>} Résultat avec statistiques
 */
export async function captureScheduledPayments(date = null) {
  const targetDate = date ? new Date(date) : new Date();
  targetDate.setHours(0, 0, 0, 0); // Début de la journée
  
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999); // Fin de la journée

  console.log(`🔄 [CRON] Capturing scheduled payments for date: ${targetDate.toISOString()}`);

  // 1) Récupérer les paiements autorisés avec scheduled_date <= aujourd'hui
  const { data: payments, error } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("status", "authorized")
    .not("scheduled_date", "is", null)
    .lte("scheduled_date", endOfDay.toISOString())
    .order("scheduled_date", { ascending: true });

  if (error) {
    console.error("❌ [CRON] Error fetching scheduled payments:", error);
    throw error;
  }

  if (!payments || payments.length === 0) {
    console.log("ℹ️ [CRON] No scheduled payments to capture");
    return {
      success: true,
      captured: 0,
      failed: 0,
      skipped: 0,
      payments: [],
    };
  }

  console.log(`📋 [CRON] Found ${payments.length} scheduled payment(s) to capture`);

  const results = {
    success: true,
    captured: 0,
    failed: 0,
    skipped: 0,
    payments: [],
  };

  // 2) Capturer chaque paiement
  for (const payment of payments) {
    try {
      // Vérifier que la date d'échéance est bien arrivée
      const scheduledDate = new Date(payment.scheduled_date);
      if (scheduledDate > new Date()) {
        console.log(`⏭️ [CRON] Skipping payment ${payment.id} - scheduled date not yet reached`);
        results.skipped++;
        continue;
      }

      console.log(`🔄 [CRON] Capturing payment ${payment.id} (${payment.type}, ${payment.amount}€, payment_intent: ${payment.stripe_payment_intent_id})`);

      // Vérifier le statut du Payment Intent AVANT de capturer (pour éviter les erreurs)
      if (payment.stripe_payment_intent_id) {
        try {
          const { default: stripe } = await import("stripe");
          const stripeInstance = new stripe(process.env.STRIPE_SECRET_KEY, {
            apiVersion: "2025-11-17.clover",
          });
          
          const paymentIntent = await stripeInstance.paymentIntents.retrieve(payment.stripe_payment_intent_id);
          
          if (paymentIntent.status !== "requires_capture") {
            console.warn(`⚠️ [CRON] Skipping payment ${payment.id} - Payment Intent ${payment.stripe_payment_intent_id} status is "${paymentIntent.status}" (expected "requires_capture")`);
            results.skipped++;
            results.payments.push({
              id: payment.id,
              status: "skipped",
              reason: `Payment Intent status is "${paymentIntent.status}" instead of "requires_capture"`,
              amount: payment.amount,
              type: payment.type,
            });
            continue;
          }
          
          console.log(`✅ [CRON] Payment Intent ${payment.stripe_payment_intent_id} is ready for capture (status: ${paymentIntent.status}, amount_capturable: ${paymentIntent.amount_capturable})`);
        } catch (stripeError) {
          console.error(`❌ [CRON] Error checking Payment Intent ${payment.stripe_payment_intent_id}:`, stripeError.message);
          // Continuer quand même, la fonction captureMissionPayment gérera l'erreur
        }
      }

      // Capturer le paiement
      const captured = await captureMissionPayment(payment.id);

      results.captured++;
      results.payments.push({
        id: payment.id,
        status: "captured",
        amount: payment.amount,
        type: payment.type,
      });

      console.log(`✅ [CRON] Successfully captured payment ${payment.id}`);

      // ✅ ENVOYER NOTIFICATION À LA COMPANY (paiement programmé capturé)
      try {
        // Récupérer le Mission Agreement pour obtenir company_id
        const { data: agreement } = await supabase
          .from("mission_agreements")
          .select("company_id, title")
          .eq("id", payment.mission_agreement_id)
          .single();

        if (agreement?.company_id) {
          await sendNotificationWithDeepLink({
            userId: agreement.company_id,
            title: "Paiement programmé capturé",
            message: `Le paiement de ${payment.amount.toFixed(2)}€ pour "${agreement.title || 'votre mission'}" a été capturé automatiquement`,
            type: "mission_payment_received",
            id: payment.mission_agreement_id,
          });
        }
      } catch (notifError) {
        console.error(`⚠️ [CRON] Notification send failed for payment ${payment.id}:`, notifError);
        // Ne pas faire échouer le processus si la notification échoue
      }

      // ✅ ENVOYER NOTIFICATION AU DETAILER (paiement reçu)
      try {
        const { data: agreement } = await supabase
          .from("mission_agreements")
          .select("detailer_id, title")
          .eq("id", payment.mission_agreement_id)
          .single();

        if (agreement?.detailer_id) {
          await sendNotificationWithDeepLink({
            userId: agreement.detailer_id,
            title: "Paiement reçu",
            message: `Un paiement de ${payment.amount.toFixed(2)}€ pour "${agreement.title || 'votre mission'}" a été capturé`,
            type: "mission_payment_received",
            id: payment.mission_agreement_id,
          });
        }
      } catch (notifError) {
        console.error(`⚠️ [CRON] Notification send failed for detailer (payment ${payment.id}):`, notifError);
      }

    } catch (err) {
      console.error(`❌ [CRON] Failed to capture payment ${payment.id}:`, err);
      results.failed++;
      results.payments.push({
        id: payment.id,
        status: "failed",
        error: err.message,
        amount: payment.amount,
        type: payment.type,
      });

      // ✅ ENVOYER NOTIFICATION À LA COMPANY (échec de capture)
      try {
        const { data: agreement } = await supabase
          .from("mission_agreements")
          .select("company_id, title")
          .eq("id", payment.mission_agreement_id)
          .single();

        if (agreement?.company_id) {
          await sendNotificationWithDeepLink({
            userId: agreement.company_id,
            title: "Échec de capture",
            message: `Le paiement programmé de ${payment.amount.toFixed(2)}€ pour "${agreement.title || 'votre mission'}" a échoué. Veuillez vérifier votre moyen de paiement.`,
            type: "mission_payment_failed",
            id: payment.mission_agreement_id,
          });
        }
      } catch (notifError) {
        console.error(`⚠️ [CRON] Notification send failed for failed payment ${payment.id}:`, notifError);
      }
    }
  }

  console.log(`✅ [CRON] Completed: ${results.captured} captured, ${results.failed} failed, ${results.skipped} skipped`);

  return results;
}
