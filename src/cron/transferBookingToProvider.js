/**
 * Transfère au détaileur la part des réservations payées, 3h après l'heure de la résa.
 * La capture a lieu à la confirmation (commission NIOS gardée sur la plateforme).
 * Ce cron exécute le Transfer Stripe vers le compte connecté du provider.
 */

import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { BOOKING_COMMISSION_RATE } from "../config/commission.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const COMMISSION_RATE = BOOKING_COMMISSION_RATE; // 10%
const HOURS_AFTER_BOOKING = 3;

/**
 * Date/heure de fin du créneau résa + 3h (ISO).
 * Interprète date + start_time en heure locale serveur, puis ajoute 3h.
 */
function getTransferEligibleAfter(booking) {
  const dateStr = booking.date; // "2025-02-15"
  const startTime = (booking.start_time || "00:00").trim().slice(0, 5); // "14:00"
  const [h, m] = startTime.split(":").map((x) => parseInt(x, 10) || 0);
  const d = new Date(dateStr + "T" + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":00");
  if (Number.isNaN(d.getTime())) return null;
  d.setTime(d.getTime() + HOURS_AFTER_BOOKING * 60 * 60 * 1000);
  return d.toISOString();
}

/**
 * Récupère le stripe_account_id du provider (booking.provider_id = id ou user_id du profile).
 */
async function getProviderStripeAccountId(providerId) {
  if (!providerId) return null;
  const { data, error } = await supabase
    .from("provider_profiles")
    .select("stripe_account_id")
    .or(`id.eq.${providerId},user_id.eq.${providerId}`)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[TRANSFER_BOOKING] getProviderStripeAccountId error:", error.message);
    return null;
  }
  return data?.stripe_account_id || null;
}

/**
 * Trouve les réservations éligibles au transfert (payées, charge connue, pas encore transféré, 3h après résa).
 */
async function getBookingsEligibleForTransfer() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("bookings")
    .select("id, provider_id, price, currency, date, start_time, stripe_charge_id, provider_transfer_id")
    .eq("payment_status", "paid")
    .not("stripe_charge_id", "is", null)
    .is("provider_transfer_id", null)
    .not("date", "is", null)
    .not("start_time", "is", null);

  if (error) {
    console.error("[TRANSFER_BOOKING] getBookings query error:", error);
    return [];
  }

  const eligible = [];
  for (const b of data || []) {
    const eligibleAfter = getTransferEligibleAfter(b);
    if (eligibleAfter && eligibleAfter <= now) {
      eligible.push(b);
    }
  }
  return eligible;
}

/**
 * Exécute les transferts dus (3h après l'heure de résa).
 */
export async function transferBookingToProviderCron() {
  const results = { transferred: 0, failed: 0, skipped: 0 };
  const bookings = await getBookingsEligibleForTransfer();

  for (const booking of bookings) {
    const stripeAccountId = await getProviderStripeAccountId(booking.provider_id);
    if (!stripeAccountId) {
      console.warn(`[TRANSFER_BOOKING] No Stripe account for provider ${booking.provider_id}, booking ${booking.id}`);
      results.skipped += 1;
      continue;
    }

    const amountEur = Number(booking.price) || 0;
    const commissionAmount = Math.round(amountEur * COMMISSION_RATE * 100) / 100;
    const netAmount = Math.round((amountEur - commissionAmount) * 100) / 100;
    const netCents = Math.round(netAmount * 100);
    if (netCents <= 0) {
      results.skipped += 1;
      continue;
    }

    try {
      const transfer = await stripe.transfers.create({
        amount: netCents,
        currency: (booking.currency || "eur").toLowerCase(),
        destination: stripeAccountId,
        source_transaction: booking.stripe_charge_id,
        metadata: {
          booking_id: booking.id,
          type: "booking_payout",
          commission_rate: String(COMMISSION_RATE),
          commission_amount: String(commissionAmount),
        },
      });

      await supabase
        .from("bookings")
        .update({ provider_transfer_id: transfer.id })
        .eq("id", booking.id);

      results.transferred += 1;
      console.log(`✅ [TRANSFER_BOOKING] Booking ${booking.id} → provider ${booking.provider_id}, transfer ${transfer.id}, ${netAmount}€`);
    } catch (err) {
      results.failed += 1;
      console.error(`❌ [TRANSFER_BOOKING] Booking ${booking.id} transfer error:`, err.message);
    }
  }

  return results;
}
