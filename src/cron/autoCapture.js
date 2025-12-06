import Stripe from "stripe";
import { supabase } from "../config/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function autoCaptureBookings() {
  const now = new Date();

  // fetch bookings where time + 3h < now AND payment_status="preauthorized"
  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .eq("payment_status", "preauthorized");

  for (const b of bookings) {
    const serviceDate = new Date(`${b.date}T${b.start_time}:00`);
    const autoCaptureTime = new Date(serviceDate.getTime() + 3 * 3600 * 1000);

    if (now >= autoCaptureTime) {
      console.log("Auto-capturing", b.id);
      await stripe.paymentIntents.capture(b.payment_intent_id);

      await supabase
        .from("bookings")
        .update({
          status: "confirmed",
          payment_status: "paid"
        })
        .eq("id", b.id);
    }
  }
}
