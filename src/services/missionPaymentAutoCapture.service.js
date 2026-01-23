// src/services/missionPaymentAutoCapture.service.js
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { captureMissionPayment } from "./missionPaymentStripe.service.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

/**
 * 🟦 AUTO CAPTURE MISSION PAYMENTS – Capturer automatiquement les paiements programmés
 * 
 * Cette fonction doit être appelée régulièrement (cron job) pour capturer les paiements
 * de missions qui ont atteint leur date programmée.
 * 
 * Règles :
 * - Mission < 1 mois : Acompte fin jour 1, solde dernier jour
 * - Mission ≥ 1 mois : 20% jour 1, puis paiements mensuels
 */
export async function autoCaptureMissionPayments() {
  const now = new Date();
  console.log(`🔄 [AUTO CAPTURE] Checking for scheduled payments at ${now.toISOString()}`);

  // 1) Récupérer tous les paiements programmés qui doivent être capturés
  const { data: scheduledPayments, error } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("status", "authorized") // Seulement les paiements autorisés
    .not("scheduled_date", "is", null) // Avec une date programmée
    .lte("scheduled_date", now.toISOString()); // Date programmée <= maintenant

  if (error) {
    console.error("❌ [AUTO CAPTURE] Error fetching scheduled payments:", error);
    throw error;
  }

  if (!scheduledPayments || scheduledPayments.length === 0) {
    console.log("ℹ️ [AUTO CAPTURE] No payments to capture at this time");
    return { captured: 0, errors: [] };
  }

  console.log(`📋 [AUTO CAPTURE] Found ${scheduledPayments.length} payment(s) to capture`);

  const results = {
    captured: 0,
    errors: [],
  };

  // 2) Capturer chaque paiement
  for (const payment of scheduledPayments) {
    try {
      console.log(`🔄 [AUTO CAPTURE] Processing payment ${payment.id} (type: ${payment.type}, amount: ${payment.amount}€, scheduled: ${payment.scheduled_date})`);

      // Vérifier le statut du Payment Intent AVANT de capturer (pour éviter les erreurs)
      if (payment.stripe_payment_intent_id) {
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);
          
          if (paymentIntent.status !== "requires_capture") {
            console.warn(`⚠️ [AUTO CAPTURE] Skipping payment ${payment.id} - Payment Intent ${payment.stripe_payment_intent_id} status is "${paymentIntent.status}" (expected "requires_capture")`);
            results.errors.push({
              paymentId: payment.id,
              error: `Payment Intent status is "${paymentIntent.status}" instead of "requires_capture"`,
            });
            continue;
          }
          
          if (paymentIntent.amount_capturable === 0) {
            console.warn(`⚠️ [AUTO CAPTURE] Skipping payment ${payment.id} - Payment Intent ${payment.stripe_payment_intent_id} has no capturable amount (already captured?)`);
            results.errors.push({
              paymentId: payment.id,
              error: "Payment Intent has no capturable amount (may already be captured)",
            });
            continue;
          }
          
          console.log(`✅ [AUTO CAPTURE] Payment Intent ${payment.stripe_payment_intent_id} is ready for capture (status: ${paymentIntent.status}, amount_capturable: ${paymentIntent.amount_capturable})`);
        } catch (stripeError) {
          console.error(`❌ [AUTO CAPTURE] Error checking Payment Intent ${payment.stripe_payment_intent_id}:`, stripeError.message);
          // Continuer quand même, la fonction captureMissionPayment gérera l'erreur
        }
      }
      
      await captureMissionPayment(payment.id);
      
      results.captured++;
      console.log(`✅ [AUTO CAPTURE] Payment ${payment.id} captured successfully`);
    } catch (err) {
      console.error(`❌ [AUTO CAPTURE] Failed to capture payment ${payment.id}:`, err.message);
      results.errors.push({
        paymentId: payment.id,
        error: err.message,
      });
      
      // ⚠️ Ne pas faire échouer les autres paiements si un échoue
      // Continuer avec les suivants
    }
  }

  console.log(`✅ [AUTO CAPTURE] Completed: ${results.captured} captured, ${results.errors.length} errors`);
  return results;
}

/**
 * 🟦 GET NEXT CAPTURE DATE – Récupérer la prochaine date de capture programmée
 * Utile pour planifier le prochain cron job
 */
export async function getNextCaptureDate() {
  const { data, error } = await supabase
    .from("mission_payments")
    .select("scheduled_date")
    .eq("status", "authorized")
    .not("scheduled_date", "is", null)
    .gt("scheduled_date", new Date().toISOString())
    .order("scheduled_date", { ascending: true })
    .limit(1);

  if (error) {
    console.error("❌ [AUTO CAPTURE] Error fetching next capture date:", error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  return data[0].scheduled_date;
}
