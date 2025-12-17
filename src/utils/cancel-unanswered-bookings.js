import { supabaseAdmin as supabase } from "../config/supabase.js";
import { refundPayment } from "../services/payment.service.js";

export async function autoCancelUnansweredBookings() {

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("status", "pending")
    .eq("payment_status", "preauthorized");

  if (error) {
    console.error("Cron fetch error:", error);
    return;
  }

  const now = new Date();

  for (const b of bookings) {
    const created = new Date(b.created_at);
    const hours = (now - created) / (1000 * 60 * 60);

    if (hours >= 24) {

      console.log(`⏰ Auto-cancelling booking ${b.id}`);

      // Refund preauthorization
      if (b.payment_intent_id) {
        await refundPayment(b.payment_intent_id);
      }

      // Update DB
      await supabase
        .from("bookings")
        .update({
          status: "cancelled",
          payment_status: "refunded",
        })
        .eq("id", b.id);

    }
  }
}
