// src/services/payment.service.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

/* -----------------------------------------------------
   CREATE PAYMENT INTENT — Préautorisation standard
----------------------------------------------------- */
export async function createPaymentIntent({ amount, currency, userId }) {
  try {
    // Stripe attend amount en CENTS → iOS t’envoie un prix en EUR → multiplie 100 ici
    const stripeIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // € → cents
      currency,
      capture_method: "manual", // Préautorisation
      metadata: {
        userId,
        source: "beldetailing-app",
      },
    });

    return {
      id: stripeIntent.id,
      clientSecret: stripeIntent.client_secret,
      amount,
      currency,
      status: stripeIntent.status,
    };
  } catch (err) {
    console.error("[STRIPE ERROR - createPaymentIntent]", err);
    throw new Error("Stripe failed to create payment intent");
  }
}

/* -----------------------------------------------------
   CAPTURE PAYMENT — Provider accepte
----------------------------------------------------- */
export async function capturePayment(paymentIntentId) {
  try {
    const captured = await stripe.paymentIntents.capture(paymentIntentId);
    return captured.status === "succeeded";
  } catch (err) {
    console.error("[STRIPE ERROR - capturePayment]", err);
    return false;
  }
}

/* -----------------------------------------------------
   REFUND PAYMENT — Provider refuse / auto-cancel
----------------------------------------------------- */
export async function refundPayment(paymentIntentId) {
  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
    });

    return refund.status === "succeeded";
  } catch (err) {
    console.error("[STRIPE ERROR - refundPayment]", err);
    return false;
  }
}
