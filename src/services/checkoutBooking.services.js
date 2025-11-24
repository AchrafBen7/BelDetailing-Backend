// src/services/checkoutBooking.service.js
import Stripe from "stripe";
import { supabase } from "../config/supabase.js";
import { ensureStripeProductForService } from "./stripeProduct.service.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

export async function createCheckoutSessionForBooking({
  bookingId,
  customerId,
  successUrl,
  cancelUrl,
}) {
  if (!bookingId) throw new Error("bookingId is required");

  // 1) Load booking
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking) throw new Error("Booking not found");

  // Ensure correct customer
  if (booking.customer_id !== customerId)
    throw new Error("You cannot pay for someone else's booking");

  if (booking.status !== "confirmed")
    throw new Error("Booking must be confirmed before payment");

  // 2) Load provider (Stripe account)
  const { data: provider, error: providerError } = await supabase
    .from("provider_profiles")
    .select("stripe_account_id")
    .eq("user_id", booking.provider_id)
    .single();

  if (providerError || !provider || !provider.stripe_account_id)
    throw new Error("Provider has no Stripe account");

  const destinationAccount = provider.stripe_account_id;

  // 3) Load service
  const { data: service, error: serviceError } = await supabase
    .from("services")
    .select("id, name, price, currency, stripe_product_id, stripe_price_id")
    .eq("id", booking.service_id)
    .single();

  if (serviceError || !service) throw new Error("Service not found");

  const currency = service.currency || "eur";

  // 4) Create product/price if needed
  const { priceId, amount } = await ensureStripeProductForService(service.id);

  const amountCents = Math.round(amount * 100);
  const feeAmount = Math.round(amountCents * (booking.commission_rate || 0.1));

  // 5) Create checkout session
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    payment_intent_data: {
      application_fee_amount: feeAmount,
      transfer_data: { destination: destinationAccount },
      metadata: { bookingId },
    },
    metadata: { bookingId },
    success_url: `${successUrl || "https://example.com"}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || "https://example.com/cancel",
  });

  // Save PI in booking
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  await supabase
    .from("bookings")
    .update({
      payment_intent_id: paymentIntentId,
      payment_status: "processing",
    })
    .eq("id", bookingId);

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
  };
}
