import { createPaymentIntent, capturePayment, refundPayment } from "../services/payment.service.js";
import { createCheckoutSessionForBooking } from "../services/checkoutBooking.services.js";

export async function createCheckoutSessionController(req, res) {
  try {
    const { bookingId, successUrl, cancelUrl } = req.body;
    const customerId = req.user.id;

    const session = await createCheckoutSessionForBooking({
      bookingId,
      customerId,
      successUrl,
      cancelUrl,
    });

    return res.json(session);
  } catch (err) {
    console.error("[CHECKOUT ERROR]", err);
    return res.status(400).json({ error: err.message });
  }
}

export async function createPaymentIntentController(req, res) {
  try {
    const { bookingId, amount, currency } = req.body;

    const intent = await createPaymentIntent({
      bookingId,
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

export async function capturePaymentController(req, res) {
  try {
    const { paymentIntentId } = req.body;

    const result = await capturePayment(paymentIntentId);

    return res.json({ success: result });
  } catch (err) {
    console.error("[CAPTURE ERROR]", err);
    return res.status(500).json({ error: "Could not capture payment" });
  }
}

export async function refundPaymentController(req, res) {
  try {
    const { paymentIntentId } = req.body;

    const result = await refundPayment(paymentIntentId);

    return res.json({ success: result });
  } catch (err) {
    console.error("[REFUND ERROR]", err);
    return res.status(500).json({ error: "Could not refund payment" });
  }
}
