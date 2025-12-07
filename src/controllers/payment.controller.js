// src/controllers/payment.controller.js

import {
  createPaymentIntent,
  capturePayment,
  refundPayment,
} from "../services/payment.service.js";

/* -----------------------------------------------------
   CREATE PAYMENT INTENT — App iOS → Stripe
----------------------------------------------------- */
export async function createPaymentIntentController(req, res) {
  try {
    const { amount, currency } = req.body;

    if (!amount || !currency) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const intent = await createPaymentIntent({
      amount,
      currency,
      userId: req.user.id,
    });

    return res.json(intent);
  } catch (err) {
    console.error("[PAYMENT INTENT ERROR]", err);
    return res.status(500).json({ error: "Could not create payment intent" });
  }
}

/* -----------------------------------------------------
   CAPTURE PAYMENT — Provider accepte la réservation
----------------------------------------------------- */
export async function capturePaymentController(req, res) {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: "Missing paymentIntentId" });
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
----------------------------------------------------- */
export async function refundPaymentController(req, res) {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: "Missing paymentIntentId" });
    }

    const ok = await refundPayment(paymentIntentId);
    return res.json({ success: ok });
  } catch (err) {
    console.error("[REFUND ERROR]", err);
    return res.status(500).json({ error: "Could not refund payment" });
  }
}
