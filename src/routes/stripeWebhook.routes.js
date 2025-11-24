import express from "express";
import Stripe from "stripe";
import { supabase } from "../config/supabase.js";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.error("❌ STRIPE_WEBHOOK_SECRET missing");
      return res.status(500).send("Webhook secret not set");
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Wrong signature", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log("📡 Webhook received:", event.type);

    /* ===========================================================
       1) CHECKOUT SESSION COMPLETED
    ============================================================ */
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // metadata.bookingId est envoyé dans createCheckoutSessionForBooking()
      const bookingId = session.metadata?.bookingId;
      const paymentIntent = session.payment_intent;

      if (!bookingId) {
        console.error("❌ No bookingId found in session metadata");
        return res.json({ received: true });
      }

      console.log(`🔄 Updating booking ${bookingId} → paid`);

      await supabase
        .from("bookings")
        .update({
          payment_status: "paid",
          payment_intent_id:
            typeof paymentIntent === "string"
              ? paymentIntent
              : paymentIntent?.id,
          status: "paid", // si tu veux que le provider voie "paid"
        })
        .eq("id", bookingId);
    }

    /* ===========================================================
       2) PAYMENT INTENT SUCCEEDED (backup)
    ============================================================ */
    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object;
      const bookingId = intent.metadata?.bookingId;

      if (bookingId) {
        console.log(`💰 PaymentIntent succeeded for booking ${bookingId}`);

        await supabase
          .from("bookings")
          .update({
            payment_status: "paid",
            payment_intent_id: intent.id,
          })
          .eq("id", bookingId);
      }
    }

    /* ===========================================================
       3) PAYMENT FAILED
    ============================================================ */
    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object;
      const bookingId = intent.metadata?.bookingId;

      if (bookingId) {
        console.log(`❌ Payment failed for booking ${bookingId}`);

        await supabase
          .from("bookings")
          .update({
            payment_status: "failed",
          })
          .eq("id", bookingId);
      }
    }

    return res.json({ received: true });
  }
);

export default router;
