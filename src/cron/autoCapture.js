import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function autoCaptureBookings() {
  const now = new Date();
  console.log(`🔄 [CRON] Auto-capturing bookings at ${now.toISOString()}`);

  // fetch bookings where time + 3h < now AND payment_status="preauthorized"
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("payment_status", "preauthorized")
    .not("payment_intent_id", "is", null);

  if (error) {
    console.error("❌ [CRON] Error fetching bookings:", error);
    throw error;
  }

  if (!bookings || bookings.length === 0) {
    console.log("ℹ️ [CRON] No bookings to auto-capture");
    return { captured: 0, errors: [] };
  }

  console.log(`📋 [CRON] Found ${bookings.length} booking(s) to check for auto-capture`);

  const results = {
    captured: 0,
    errors: [],
  };

  for (const b of bookings) {
    try {
      // Vérifier que le booking a une date et une heure
      if (!b.date || !b.start_time) {
        console.warn(`⚠️ [CRON] Skipping booking ${b.id} - missing date or start_time`);
        continue;
      }

      const serviceDate = new Date(`${b.date}T${b.start_time}:00`);
      const autoCaptureTime = new Date(serviceDate.getTime() + 3 * 3600 * 1000);

      if (now < autoCaptureTime) {
        // Pas encore le moment de capturer
        continue;
      }

      console.log(`🔄 [CRON] Attempting to capture booking ${b.id} (payment_intent: ${b.payment_intent_id})`);

      // Vérifier le statut du Payment Intent AVANT de capturer
      const paymentIntent = await stripe.paymentIntents.retrieve(b.payment_intent_id);
      
      if (paymentIntent.status !== "requires_capture") {
        console.warn(`⚠️ [CRON] Skipping booking ${b.id} - Payment Intent ${b.payment_intent_id} status is "${paymentIntent.status}" (expected "requires_capture")`);
        results.errors.push({
          bookingId: b.id,
          paymentIntentId: b.payment_intent_id,
          error: `Payment Intent status is "${paymentIntent.status}" instead of "requires_capture"`,
        });
        continue;
      }

      // Capturer le Payment Intent
      await stripe.paymentIntents.capture(b.payment_intent_id);
      console.log(`✅ [CRON] Successfully captured booking ${b.id}`);

      // Mettre à jour le booking
      await supabase
        .from("bookings")
        .update({
          status: "confirmed",
          payment_status: "paid"
        })
        .eq("id", b.id);

      results.captured++;
    } catch (err) {
      console.error(`❌ [CRON] Failed to capture booking ${b.id}:`, err.message);
      results.errors.push({
        bookingId: b.id,
        paymentIntentId: b.payment_intent_id,
        error: err.message,
      });
      // Continuer avec les autres bookings même si un échoue
    }
  }

  console.log(`✅ [CRON] Auto-capture completed: ${results.captured} captured, ${results.errors.length} errors`);
  return results;
}
