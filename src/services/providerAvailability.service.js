// src/services/providerAvailability.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { listBlockedSlots } from "./blockedSlots.service.js";

/** Durée minimale d'un créneau libre pour considérer le prestataire dispo (minutes) */
const MIN_FREE_SLOT_MINUTES = 30;

/**
 * Heures par défaut quand le prestataire n'a pas défini opening_hours :
 * Lun–Dim 8h–19h pour que le client voie beaucoup de créneaux.
 * @returns {Array<{ day: number, startTime: string, endTime: string }>}
 */
function defaultOpeningHours() {
  const result = [];
  for (let day = 1; day <= 7; day++) {
    result.push({ day, startTime: "08:00", endTime: "19:00" });
  }
  return result;
}

/**
 * Parse opening_hours (JSON). Attendu: tableau ou objet avec day (1-7), startTime, endTime, isClosed.
 * @returns {Array<{ day: number, startTime: string, endTime: string, isClosed: boolean }>}
 */
function parseOpeningHours(openingHours) {
  if (!openingHours) return [];
  if (typeof openingHours === "string") {
    try {
      openingHours = JSON.parse(openingHours);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(openingHours)) return [];
  return openingHours.filter((h) => {
    if (!h || typeof h.day === "undefined") return false;
    const day = typeof h.day === "number" ? h.day : parseInt(h.day, 10);
    if (Number.isNaN(day) || day < 1 || day > 7) return false;
    if (h.isClosed === true) return false;
    const start = h.startTime || h.start_time;
    const end = h.endTime || h.end_time;
    return start && end;
  });
}

/** Convert "HH:mm" to minutes since midnight */
function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Day of week 1-7 (1 = Monday, 7 = Sunday) from JS Date (getDay: 0=Sun, 1=Mon, ...) */
function getDayOfWeek(date) {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}

/** Day of week 1-7 from calendar date string YYYY-MM-DD (timezone-safe: UTC noon so jour choisi par le client est respecté) */
function getDayOfWeekFromDateStr(dateStr) {
  const date = new Date(dateStr + "T12:00:00.000Z");
  if (Number.isNaN(date.getTime())) return null;
  const utcDay = date.getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

/** Minutes since midnight → "HH:mm" */
function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Merge overlapping intervals and return free gaps in [openStart, openEnd].
 * intervals = [[startMin, endMin], ...] (booked), openStart/openEnd in minutes.
 * @returns Array of [start, end] free segments
 */
function freeSegments(openStart, openEnd, intervals) {
  if (openStart >= openEnd) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let currentStart = openStart;
  for (const [start, end] of sorted) {
    if (end <= currentStart) continue;
    if (start > currentStart) {
      gaps.push([currentStart, Math.min(start, openEnd)]);
    }
    currentStart = Math.max(currentStart, end);
    if (currentStart >= openEnd) break;
  }
  if (currentStart < openEnd) {
    gaps.push([currentStart, openEnd]);
  }
  return gaps;
}

/**
 * Vérifie si le prestataire a au moins un créneau libre cette semaine (basé sur horaires + résas).
 * @param {Object} providerRow - { id?, user_id?, opening_hours }
 * @param {Map<string, Array<{ date, start_time, end_time }>>} bookingsByProviderId - résas groupées par provider_id
 * @param {Array<{ date: Date, dayOfWeek: number }>} weekDays - les 7 jours de la semaine
 * @returns {boolean}
 */
function providerHasFreeSlotThisWeek(providerRow, bookingsByProviderId, weekDays) {
  // bookings.provider_id est en général le user_id du prestataire
  const lookupKey = providerRow.user_id ?? providerRow.id;
  if (!lookupKey) return false;

  // Si pas d'horaires définis → fallback Lun-Sam 9h-18h pour que les detailers apparaissent quand même
  let openingHoursList = parseOpeningHours(providerRow.opening_hours);
  if (openingHoursList.length === 0) {
    openingHoursList = defaultOpeningHours();
  }

  const byDay = new Map();
  for (const oh of openingHoursList) {
    const day = typeof oh.day === "number" ? oh.day : parseInt(oh.day, 10);
    if (Number.isNaN(day) || day < 1 || day > 7) continue;
    const startTime = oh.startTime || oh.start_time;
    const endTime = oh.endTime || oh.end_time;
    byDay.set(day, { start: timeToMinutes(startTime), end: timeToMinutes(endTime) });
  }

  const bookings = bookingsByProviderId.get(String(lookupKey)) ?? [];

  for (const { date, dayOfWeek } of weekDays) {
    const open = byDay.get(dayOfWeek);
    if (!open || open.start >= open.end) continue;

    const dateStr = date.toISOString().slice(0, 10);
    const dayBookings = bookings
      .filter((b) => (b.date || "").toString().slice(0, 10) === dateStr)
      .map((b) => [timeToMinutes(b.start_time || "00:00"), timeToMinutes(b.end_time || "23:59")]);

    const gaps = freeSegments(open.start, open.end, dayBookings);
    const hasEnoughGap = gaps.some(([start, end]) => end - start >= MIN_FREE_SLOT_MINUTES);
    if (hasEnoughGap) return true;
  }
  return false;
}

/**
 * Retourne les IDs de prestataires qui ont au moins un créneau libre cette semaine (calendrier = horaires - résas).
 * @param {Array<Object>} providerRows - lignes provider_profiles avec id/user_id et opening_hours
 * @returns {Promise<Set<string>>} IDs (id ou user_id selon la table)
 */
export async function getProviderIdsWithAvailabilityThisWeek(providerRows) {
  if (!Array.isArray(providerRows) || providerRows.length === 0) {
    return new Set();
  }

  // bookings.provider_id = user_id du prestataire (voir booking.service)
  const providerIds = providerRows.map((r) => r.user_id ?? r.id).filter(Boolean);
  if (providerIds.length === 0) return new Set();

  const now = new Date();
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    const dateStr = d.toISOString().slice(0, 10);
    weekDays.push({ date: d, dayOfWeek: getDayOfWeek(d) });
  }

  const startDate = weekDays[0].date.toISOString().slice(0, 10);
  const endDate = weekDays[6].date.toISOString().slice(0, 10);

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("provider_id, date, start_time, end_time")
    .in("provider_id", providerIds)
    .gte("date", startDate)
    .lte("date", endDate)
    .in("status", ["pending", "confirmed", "started", "in_progress", "ready_soon"]);

  if (error) {
    console.warn("[providerAvailability] bookings fetch error:", error.message);
    return new Set();
  }

  const bookingsByProviderId = new Map();
  for (const b of bookings || []) {
    const key = String(b.provider_id);
    if (!bookingsByProviderId.has(key)) bookingsByProviderId.set(key, []);
    bookingsByProviderId.get(key).push({
      date: b.date,
      start_time: b.start_time,
      end_time: b.end_time,
    });
  }

  const availableIds = new Set();
  for (const row of providerRows) {
    if (providerHasFreeSlotThisWeek(row, bookingsByProviderId, weekDays)) {
      const id = row.id ?? row.user_id;
      if (id) availableIds.add(String(id));
    }
  }
  return availableIds;
}

/** Pas des créneaux proposés (minutes) */
const SLOT_STEP_MINUTES = 30;

/**
 * Créneaux disponibles pour un prestataire à une date donnée, basés sur :
 * - horaires d'ouverture du jour (opening_hours),
 * - réservations déjà prises (pending, confirmed, started, in_progress, ready_soon),
 * - durée du service : un créneau est proposé seulement si [start, start+duration] tient dans un trou libre.
 * @param {string} providerId - id ou user_id du prestataire
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {number} durationMinutes - durée estimée du service (ex. 120 pour 2h)
 * @returns {Promise<string[]>} tableau de "HH:mm" (début de créneau)
 */
export async function getAvailableSlotsForDate(providerId, dateStr, durationMinutes) {
  const duration = Math.max(15, Number(durationMinutes) || 60);

  // 1) Récupérer le profil (opening_hours) – essayer user_id d'abord (souvent l'app envoie user_id comme providerId)
  let { data: profile, error: profileError } = await supabase
    .from("provider_profiles")
    .select("id, user_id, opening_hours")
    .eq("user_id", providerId)
    .maybeSingle();

  if (profileError || !profile) {
    const { data: byId } = await supabase
      .from("provider_profiles")
      .select("id, user_id, opening_hours")
      .eq("id", providerId)
      .maybeSingle();
    profile = byId;
  }

  if (!profile) {
    console.warn("[providerAvailability] getAvailableSlotsForDate no profile for providerId:", providerId, "date:", dateStr);
    return [];
  }

  let openingHoursList = parseOpeningHours(profile?.opening_hours);
  if (openingHoursList.length === 0) {
    openingHoursList = defaultOpeningHours();
  }

  const dayOfWeek = getDayOfWeekFromDateStr(dateStr);
  if (dayOfWeek == null) {
    console.warn("[providerAvailability] getAvailableSlotsForDate invalid date:", dateStr);
    return [];
  }

  const byDay = new Map();
  for (const oh of openingHoursList) {
    const day = typeof oh.day === "number" ? oh.day : parseInt(oh.day, 10);
    if (Number.isNaN(day) || day < 1 || day > 7) continue;
    const startTime = oh.startTime || oh.start_time;
    const endTime = oh.endTime || oh.end_time;
    if (!startTime || !endTime) continue;
    byDay.set(day, { start: timeToMinutes(startTime), end: timeToMinutes(endTime) });
  }

  const open = byDay.get(dayOfWeek);
  if (!open || open.start >= open.end) {
    console.warn("[providerAvailability] getAvailableSlotsForDate no opening hours for day", dayOfWeek, "providerId:", providerId);
    return [];
  }

  const providerIdKeys = [profile.id, profile.user_id].filter(Boolean);
  const uniqueKeys = [...new Set(providerIdKeys)];
  if (uniqueKeys.length === 0) return [];

  // 2) Réservations ce jour-là (provider_id peut être id ou user_id selon le client)
  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("start_time, end_time")
    .in("provider_id", uniqueKeys)
    .eq("date", dateStr)
    .in("status", ["pending", "confirmed", "started", "in_progress", "ready_soon"]);

  if (bookingsError) {
    console.warn("[providerAvailability] getAvailableSlotsForDate bookings error:", bookingsError.message);
    return [];
  }

  let bookedIntervals = (bookings || []).map((b) => [
    timeToMinutes(b.start_time || "00:00"),
    timeToMinutes(b.end_time || "23:59"),
  ]);

  // 2b) Blocked slots ce jour-là (full-day ou plage horaire) – provider_blocked_slots.provider_id = user_id
  const lookupKey = profile.user_id ?? profile.id;
  try {
    const blocked = await listBlockedSlots(lookupKey, { from: dateStr, to: dateStr });
    for (const b of blocked) {
      if (b.startTime == null && b.endTime == null) {
        bookedIntervals.push([open.start, open.end]);
      } else {
        bookedIntervals.push([
          timeToMinutes(b.startTime || "00:00"),
          timeToMinutes(b.endTime || "23:59"),
        ]);
      }
    }
  } catch (err) {
    console.warn("[providerAvailability] getAvailableSlotsForDate blocked slots error:", err?.message);
  }

  const segments = freeSegments(open.start, open.end, bookedIntervals);
  const slots = [];

  for (const [segStart, segEnd] of segments) {
    let t = segStart;
    while (t + duration <= segEnd) {
      slots.push(minutesToTime(t));
      t += SLOT_STEP_MINUTES;
    }
  }

  if (slots.length === 0) {
    console.warn("[providerAvailability] getAvailableSlotsForDate zero slots providerId:", providerId, "date:", dateStr, "dayOfWeek:", dayOfWeek, "open:", open.start, "-", open.end, "bookings:", (bookings || []).length);
  }

  return slots;
}
