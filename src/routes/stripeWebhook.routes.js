// src/routes/stripeWebhook.routes.js
import express from "express";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { sendNotificationToUser } from "../services/onesignal.service.js";

const router = express.Router();

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY for webhooks");
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn("⚠️ STRIPE_WEBHOOK_SECRET is not set – webhooks won't be verified!");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

// IMPORTANT : express.raw() uniquement sur ce endpoint
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

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;

          const bookingId = session.metadata?.bookingId;
          const paymentIntentId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id ?? null;

          if (!bookingId) {
            console.warn("⚠️ checkout.session.completed without bookingId");
            break;
          }

          console.log(
            `✅ Mark booking ${bookingId} as paid (PI=${paymentIntentId})`
          );

          await supabase
            .from("bookings")
            .update({
              payment_status: "paid",
              status: "paid",
              payment_intent_id: paymentIntentId,
            })
            .eq("id", bookingId);

          break;
        }

        case "payment_intent.succeeded": {
          const intent = event.data.object;
          const bookingId = intent.metadata?.bookingId;
          const userId = intent.metadata?.userId ?? null;
          const amount = intent.amount / 100;
          const currency = intent.currency;

          await supabase.from("payment_transactions").insert({
            user_id: userId,
            stripe_object_id: intent.id,
            amount: amount,
            currency: currency,
            status: intent.status,
            type: "payment",
          });

          if (!bookingId) {
            console.log("payment_intent.succeeded (no bookingId), skipping");
            break;
          }

          console.log(`✅ PI succeeded for booking ${bookingId}`);

          await supabase
            .from("bookings")
            .update({
              payment_status: "paid",
              payment_intent_id: intent.id,
            })
            .eq("id", bookingId);

          // ✅ ENVOYER NOTIFICATION AU CUSTOMER (paiement réussi)
          try {
            if (userId) {
              await sendNotificationToUser({
                userId: userId, // Customer reçoit la notification
                title: "Paiement confirmé",
                message: `Votre paiement de ${amount.toFixed(2)}${currency === "eur" ? "€" : currency.toUpperCase()} a été confirmé`,
                data: {
                  type: "payment_succeeded",
                  booking_id: bookingId,
                  transaction_id: intent.id,
                  amount: amount,
                },
              });
            }
          } catch (notifError) {
            console.error("[WEBHOOK] Notification send failed:", notifError);
            // ⚠️ Ne pas bloquer le webhook si la notification échoue
          }

          break;
        }

        case "payment_intent.payment_failed": {
          const intent = event.data.object;
          const bookingId = intent.metadata?.bookingId;
          const userId = intent.metadata?.userId ?? null;

          if (!bookingId) {
            console.log("payment_intent.failed (no bookingId), skipping");
            break;
          }

          console.log(`❌ PI failed for booking ${bookingId}`);

          await supabase
            .from("bookings")
            .update({
              payment_status: "failed",
            })
            .eq("id", bookingId);

          // ✅ ENVOYER NOTIFICATION AU CUSTOMER (paiement échoué)
          try {
            if (userId) {
              await sendNotificationToUser({
                userId: userId, // Customer reçoit la notification
                title: "Paiement échoué",
                message: "Votre paiement a échoué. Veuillez réessayer.",
                data: {
                  type: "payment_failed",
                  booking_id: bookingId,
                  transaction_id: intent.id,
                },
              });
            }
          } catch (notifError) {
            console.error("[WEBHOOK] Notification send failed:", notifError);
            // ⚠️ Ne pas bloquer le webhook si la notification échoue
          }

          break;
        }
        
case "setup_intent.succeeded": {
  const setupIntent = event.data.object;

  const customerId = setupIntent.customer;
  const paymentMethodId = setupIntent.payment_method;

  if (!customerId || !paymentMethodId) break;

  // ✅ NE PAS re-attach
  // Stripe l’a déjà fait

  // Juste définir comme carte par défaut
  await stripe.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  });

  break;
}
        case "refund.succeeded": {
          const refund = event.data.object;
          const paymentIntentId = refund.payment_intent;
          const refundAmount = refund.amount / 100;
          const currency = refund.currency;

          await supabase.from("payment_transactions").insert({
            user_id: refund.metadata?.userId ?? null,
            stripe_object_id: refund.id,
            amount: -refundAmount,
            currency: currency,
            status: refund.status,
            type: "refund",
          });

          if (!paymentIntentId) {
            console.log("refund event without payment_intent, skipping");
            break;
          }

          console.log(
            `💸 Refund detected for payment_intent ${paymentIntentId}`
          );

          // Récupérer le booking pour connaître le customer_id
          const { data: booking } = await supabase
            .from("bookings")
            .select("id, customer_id")
            .eq("payment_intent_id", paymentIntentId)
            .maybeSingle();

          await supabase
            .from("bookings")
            .update({
              payment_status: "refunded",
              status: "cancelled", // ou "refunded" selon ta logique
            })
            .eq("payment_intent_id", paymentIntentId);

          // ✅ ENVOYER NOTIFICATION AU CUSTOMER (remboursement effectué)
          try {
            const userId = booking?.customer_id || refund.metadata?.userId;
            if (userId) {
              await sendNotificationToUser({
                userId: userId, // Customer reçoit la notification
                title: "Remboursement effectué",
                message: `Votre remboursement de ${refundAmount.toFixed(2)}${currency === "eur" ? "€" : currency.toUpperCase()} a été effectué`,
                data: {
                  type: "refund_processed",
                  booking_id: booking?.id ?? null,
                  transaction_id: refund.id,
                  amount: refundAmount,
                },
              });
            }
          } catch (notifError) {
            console.error("[WEBHOOK] Notification send failed:", notifError);
            // ⚠️ Ne pas bloquer le webhook si la notification échoue
          }

          break;
        }

        case "charge.refunded":
        case "charge.refund.updated": {
          // Selon l'event que tu actives
          const chargeOrRefund = event.data.object;
          const paymentIntentId = chargeOrRefund.payment_intent;

          if (!paymentIntentId) {
            console.log("refund event without payment_intent, skipping");
            break;
          }

          console.log(
            `💸 Refund detected for payment_intent ${paymentIntentId}`
          );

          // Récupérer le booking pour connaître le customer_id
          const { data: booking } = await supabase
            .from("bookings")
            .select("id, customer_id, price")
            .eq("payment_intent_id", paymentIntentId)
            .maybeSingle();

          const refundAmount = chargeOrRefund.amount_refunded 
            ? chargeOrRefund.amount_refunded / 100 
            : (booking?.price || 0);

          await supabase
            .from("bookings")
            .update({
              payment_status: "refunded",
              status: "cancelled", // ou "refunded" selon ta logique
            })
            .eq("payment_intent_id", paymentIntentId);

          // ✅ ENVOYER NOTIFICATION AU CUSTOMER (remboursement effectué)
          try {
            if (booking?.customer_id) {
              await sendNotificationToUser({
                userId: booking.customer_id, // Customer reçoit la notification
                title: "Remboursement effectué",
                message: `Votre remboursement de ${refundAmount.toFixed(2)}€ a été effectué`,
                data: {
                  type: "refund_processed",
                  booking_id: booking.id,
                  transaction_id: chargeOrRefund.id,
                  amount: refundAmount,
                },
              });
            }
          } catch (notifError) {
            console.error("[WEBHOOK] Notification send failed:", notifError);
            // ⚠️ Ne pas bloquer le webhook si la notification échoue
          }

          break;
        }

        case "payout.paid": {
          const payout = event.data.object;

          await supabase.from("payment_transactions").insert({
            user_id: payout.metadata?.providerUserId ?? null,
            stripe_object_id: payout.id,
            amount: payout.amount / 100,
            currency: payout.currency,
            status: payout.status,
            type: "payout",
          });

          break;
        }

        default:
          console.log(`ℹ️ Unhandled event type ${event.type}`);
      }

      res.json({ received: true });
    } catch (err) {
      console.error("💥 Webhook handler error:", err);
      res.status(500).send("Webhook handler error");
    }
  }
);

export default router;
