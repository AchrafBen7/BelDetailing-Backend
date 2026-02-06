// src/controllers/payment.controller.js

import {
  createPaymentIntent,
  capturePayment,
  refundPayment,
  createSetupIntent,
  listPaymentMethods,
  listUserTransactions,
  detachPaymentMethod,
} from "../services/payment.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";

/* -----------------------------------------------------
   CREATE PAYMENT INTENT — App iOS → Stripe
----------------------------------------------------- */
export async function createPaymentIntentController(req, res) {
  try {
    const { amount, currency } = req.body;

    if (!amount || !currency) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, email, phone, stripe_customer_id")
      .eq("id", req.user.id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    const intent = await createPaymentIntent({
      amount,
      currency,
      user,
    });

    return res.json(intent);
  } catch (err) {
    console.error("[PAYMENT INTENT ERROR]", err);
    return res.status(500).json({ error: "Could not create payment intent" });
  }
}

/* -----------------------------------------------------
   CAPTURE PAYMENT — Provider accepte la réservation
   🔒 SECURITY: Vérifie que le PaymentIntent appartient à un booking du user
----------------------------------------------------- */
export async function capturePaymentController(req, res) {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: "Missing paymentIntentId" });
    }

    // 🔒 Vérifier que le PaymentIntent appartient à un booking du provider
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id, provider_id, customer_id")
      .eq("payment_intent_id", paymentIntentId)
      .maybeSingle();

    if (bookingErr || !booking) {
      return res.status(404).json({ error: "Booking not found for this payment" });
    }

    if (booking.provider_id !== req.user.id && booking.customer_id !== req.user.id) {
      return res.status(403).json({ error: "You are not authorized for this payment" });
    }

    const ok = await capturePayment(paymentIntentId);
    return res.json({ success: ok });
  } catch (err) {
    console.error("[CAPTURE ERROR]", err);
    return res.status(500).json({ error: "Could not capture payment" });
  }
}

/* -----------------------------------------------------
   REFUND PAYMENT — annulation / refus
   🔒 SECURITY: Vérifie que le PaymentIntent appartient à un booking du user
----------------------------------------------------- */
export async function refundPaymentController(req, res) {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: "Missing paymentIntentId" });
    }

    // 🔒 Vérifier que le PaymentIntent appartient à un booking du user
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id, provider_id, customer_id")
      .eq("payment_intent_id", paymentIntentId)
      .maybeSingle();

    if (bookingErr || !booking) {
      return res.status(404).json({ error: "Booking not found for this payment" });
    }

    if (booking.provider_id !== req.user.id && booking.customer_id !== req.user.id) {
      return res.status(403).json({ error: "You are not authorized for this payment" });
    }

    const ok = await refundPayment(paymentIntentId);
    return res.json({ success: ok });
  } catch (err) {
    console.error("[REFUND ERROR]", err);
    return res.status(500).json({ error: "Could not refund payment" });
  }
}

/* -----------------------------------------------------
   SETUP INTENT — Ajouter une carte
----------------------------------------------------- */
export async function createSetupIntentController(req, res) {
  try {
    const result = await createSetupIntent(req.user);
    return res.json(result);
  } catch (err) {
    console.error("[SETUP INTENT ERROR]", err);
    return res.status(500).json({ error: "Could not create setup intent" });
  }
}

/* -----------------------------------------------------
   LIST PAYMENT METHODS
----------------------------------------------------- */
export async function listPaymentMethodsController(req, res) {
  try {
    const methods = await listPaymentMethods(req.user);
    return res.json({ data: methods });
  } catch (err) {
    console.error("[LIST METHODS ERROR]", err);
    return res.status(500).json({ error: "Could not fetch payment methods" });
  }
}

/* -----------------------------------------------------
   LIST PAYMENT TRANSACTIONS
----------------------------------------------------- */
export async function listTransactionsController(req, res) {
  try {
    const data = await listUserTransactions(req.user.id);
    return res.json({ data });
  } catch (err) {
    console.error("[LIST TRANSACTIONS ERROR]", err);
    return res.status(500).json({ error: "Could not fetch transactions" });
  }
}

/* -----------------------------------------------------
   DELETE PAYMENT METHOD
----------------------------------------------------- */
export async function deletePaymentMethodController(req, res) {
  try {
    const { paymentMethodId } = req.params;

    // 🔒 Fetch le user complet avec stripe_customer_id (req.user n'a que id/email/role)
    const { data: fullUser, error: userErr } = await supabase
      .from("users")
      .select("id, email, stripe_customer_id")
      .eq("id", req.user.id)
      .single();

    if (userErr || !fullUser) {
      return res.status(404).json({ error: "User not found" });
    }

    await detachPaymentMethod(fullUser, paymentMethodId);
    return res.json({ success: true });
  } catch (err) {
    console.error("[PAYMENT] delete method error", err);
    return res.status(400).json({ error: "Could not delete payment method" });
  }
}
