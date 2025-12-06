import Stripe from "stripe";
import { supabase } from "../config/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function createPaymentIntent({ bookingId, amount, currency, userId }) {
  const stripeIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),    // en cents
    currency,
    capture_method: "manual",           // 🔥 pré-autorisation, pas de capture auto
    metadata: {
      bookingId,
      userId,
    },
  });

  // (optionnel mais propre) : enregistrer l’ID dans la booking ici
  await supabase
    .from("bookings")
    .update({
      payment_intent_id: stripeIntent.id,
      payment_status: "preauthorized", // ou "pending" jusqu’au webhook
    })
    .eq("id", bookingId);

  return {
    id: stripeIntent.id,
    clientSecret: stripeIntent.client_secret,
    amount,
    currency,
    status: stripeIntent.status,
  };
}


export async function capturePayment(paymentIntentId) {
  const captured = await stripe.paymentIntents.capture(paymentIntentId);
  return captured.status === "succeeded";
}

export async function refundPayment(paymentIntentId) {
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
  });

  return refund.status === "succeeded";
}
