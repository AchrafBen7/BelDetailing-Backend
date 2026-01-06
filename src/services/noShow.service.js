import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

const PARTIAL_PAYMENT_RATE = 0.3;
const COMMISSION_RATE = 0.1;

async function getBookingDetail(id) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

async function updateBookingService(id, dataUpdate) {
  const { data, error } = await supabase
    .from("bookings")
    .update(dataUpdate)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function reportNoShow(bookingId, providerProfileId) {
  const booking = await getBookingDetail(bookingId);
  if (!booking) {
    const err = new Error("Booking not found");
    err.statusCode = 404;
    throw err;
  }

  if (booking.provider_id !== providerProfileId) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  if (booking.status !== "confirmed") {
    const err = new Error("Booking must be confirmed to report no-show");
    err.statusCode = 400;
    throw err;
  }

  if (booking.payment_status !== "paid") {
    const err = new Error("Payment must be captured to process no-show");
    err.statusCode = 400;
    throw err;
  }

  const { data: providerProfile, error: providerError } = await supabase
    .from("provider_profiles")
    .select("stripe_account_id, user_id")
    .eq("id", providerProfileId)
    .single();

  if (providerError || !providerProfile) {
    const err = new Error("Provider profile not found");
    err.statusCode = 404;
    throw err;
  }

  if (!providerProfile.stripe_account_id) {
    const err = new Error(
      "Provider does not have a Stripe account. Please complete onboarding first."
    );
    err.statusCode = 400;
    throw err;
  }

  const totalAmount = Number(booking.price) || 0;
  const partialPaymentAmount =
    Math.round(totalAmount * PARTIAL_PAYMENT_RATE * 100) / 100;
  const partialPaymentAmountCents = Math.round(partialPaymentAmount * 100);

  const commissionAmount =
    Math.round(partialPaymentAmount * COMMISSION_RATE * 100) / 100;
  const commissionAmountCents = Math.round(commissionAmount * 100);

  const providerNetAmount = partialPaymentAmount - commissionAmount;
  const providerNetAmountCents = Math.round(providerNetAmount * 100);

  if (!booking.payment_intent_id) {
    const err = new Error("No payment intent found for this booking");
    err.statusCode = 400;
    throw err;
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(
      booking.payment_intent_id
    );

    if (paymentIntent.status !== "succeeded") {
      const err = new Error(
        "Payment intent is not succeeded. Cannot process no-show."
      );
      err.statusCode = 400;
      throw err;
    }
  } catch (stripeError) {
    console.error("[NO-SHOW] PaymentIntent retrieve error:", stripeError);
    const err = new Error(
      `Could not retrieve payment intent: ${stripeError.message}`
    );
    err.statusCode = 500;
    throw err;
  }

  try {
    const transfer = await stripe.transfers.create({
      amount: providerNetAmountCents,
      currency: booking.currency || "eur",
      destination: providerProfile.stripe_account_id,
      metadata: {
        booking_id: bookingId,
        type: "no_show_partial_payment",
        total_amount: String(totalAmount),
        partial_payment_amount: String(partialPaymentAmount),
        commission_amount: String(commissionAmount),
        provider_net_amount: String(providerNetAmount),
        payment_intent_id: booking.payment_intent_id,
      },
    });

    console.log(
      `✅ [NO-SHOW] Transfer created: ${transfer.id} for booking ${bookingId}`
    );

    await supabase.from("payment_transactions").insert({
      user_id: providerProfile.user_id,
      stripe_object_id: transfer.id,
      amount: providerNetAmount,
      currency: booking.currency || "eur",
      status: transfer.reversed ? "reversed" : "succeeded",
      type: "no_show_payout",
      metadata: {
        booking_id: bookingId,
        total_amount: totalAmount,
        partial_payment_amount: partialPaymentAmount,
        commission_amount: commissionAmount,
      },
    });

    await updateBookingService(bookingId, {
      status: "cancelled",
      payment_status: "partially_refunded",
    });

    return {
      partialPaymentAmount,
      commissionAmount,
      providerNetAmount,
      transferId: transfer.id,
    };
  } catch (stripeError) {
    console.error("[NO-SHOW] Stripe transfer error:", stripeError);
    const err = new Error(`Stripe transfer failed: ${stripeError.message}`);
    err.statusCode = 500;
    throw err;
  }
}
