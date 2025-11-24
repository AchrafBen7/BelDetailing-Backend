import Stripe from "stripe";
import { supabase } from "../config/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function createPaymentIntent({ bookingId, amount, currency, userId }) {
  // amount en CENTIMES
  const stripeIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: currency,
    metadata: {
      bookingId,
      userId,
    },
  });

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
