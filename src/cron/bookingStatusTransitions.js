// src/cron/bookingStatusTransitions.js
// Transitions automatiques : confirmed → ready_soon (-15 min), ready_soon → started (à l'heure de début)

import { supabaseAdmin as supabase } from "../config/supabase.js";

const READY_SOON_MINUTES_BEFORE = 15;

/**
 * Passe les réservations "confirmed" en "ready_soon" quand le service est dans moins de 15 min.
 */
export async function transitionConfirmedToReadySoon() {
  const now = new Date();
  const in15Min = new Date(now.getTime() + READY_SOON_MINUTES_BEFORE * 60 * 1000);

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, date, start_time, status")
    .eq("status", "confirmed")
    .not("date", "is", null)
    .not("start_time", "is", null);

  if (error) {
    console.error("❌ [CRON bookingStatus] Error fetching confirmed bookings:", error);
    return { updated: 0, errors: [error.message] };
  }

  let updated = 0;
  for (const b of bookings || []) {
    const startAt = new Date(`${b.date}T${b.start_time}:00`);
    // Déjà passé → on ne touche pas (le cron "ready_soon → started" s'en occupera si besoin)
    if (startAt <= now) continue;
    // Dans moins de 15 min et pas encore après l'heure de début
    if (startAt <= in15Min) {
      const { error: upErr } = await supabase
        .from("bookings")
        .update({ status: "ready_soon" })
        .eq("id", b.id);
      if (!upErr) {
        updated++;
        console.log(`✅ [CRON bookingStatus] Booking ${b.id} → ready_soon`);
      }
    }
  }
  return { updated, errors: [] };
}

/**
 * Passe les réservations "ready_soon" en "started" quand l'heure de début est atteinte.
 */
export async function transitionReadySoonToStarted() {
  const now = new Date();

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, date, start_time, status")
    .eq("status", "ready_soon")
    .not("date", "is", null)
    .not("start_time", "is", null);

  if (error) {
    console.error("❌ [CRON bookingStatus] Error fetching ready_soon bookings:", error);
    return { updated: 0, errors: [error.message] };
  }

  let updated = 0;
  for (const b of bookings || []) {
    const startAt = new Date(`${b.date}T${b.start_time}:00`);
    if (startAt <= now) {
      const { error: upErr } = await supabase
        .from("bookings")
        .update({ status: "started" })
        .eq("id", b.id);
      if (!upErr) {
        updated++;
        console.log(`✅ [CRON bookingStatus] Booking ${b.id} → started`);
      }
    }
  }
  return { updated, errors: [] };
}

/**
 * Exécute les deux transitions (à appeler toutes les 5–10 min).
 */
export async function runBookingStatusTransitions() {
  console.log("🔄 [CRON bookingStatus] Running transitions...");
  const r1 = await transitionConfirmedToReadySoon();
  const r2 = await transitionReadySoonToStarted();
  const total = r1.updated + r2.updated;
  if (total > 0) {
    console.log(`✅ [CRON bookingStatus] Done: ${total} booking(s) updated`);
  }
  return { readySoon: r1.updated, started: r2.updated };
}
