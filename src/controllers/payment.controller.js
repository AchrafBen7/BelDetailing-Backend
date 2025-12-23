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
    await detachPaymentMethod(req.user, paymentMethodId);
    return res.json({ success: true });
  } catch (err) {
    console.error("[PAYMENT] delete method error", err);
    return res.status(400).json({ error: err.message });
  }
}
