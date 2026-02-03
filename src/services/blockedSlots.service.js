// src/services/blockedSlots.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * List blocked slots for a provider (optionally filter by date range).
 * @param {string} providerId - provider_profiles.user_id
 * @param {{ from?: string, to?: string }} options - date range YYYY-MM-DD
 */
export async function listBlockedSlots(providerId, options = {}) {
  let query = supabase
    .from("provider_blocked_slots")
    .select("id, provider_id, slot_date, start_time, end_time, created_at")
    .eq("provider_id", providerId)
    .order("slot_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (options.from) {
    query = query.gte("slot_date", options.from);
  }
  if (options.to) {
    query = query.lte("slot_date", options.to);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    providerId: row.provider_id,
    date: row.slot_date,
    time: row.start_time && row.end_time ? `${row.start_time}-${row.end_time}` : "journée entière",
    slotDate: row.slot_date,
    startTime: row.start_time,
    endTime: row.end_time,
    createdAt: row.created_at,
  }));
}

/**
 * Create a blocked slot. Full-day if startTime/endTime null.
 * @param {string} providerId
 * @param {string} slotDate - YYYY-MM-DD
 * @param {string|null} startTime - HH:mm or null for full day
 * @param {string|null} endTime - HH:mm or null for full day
 */
export async function createBlockedSlot(providerId, slotDate, startTime, endTime) {
  const payload = {
    provider_id: providerId,
    slot_date: slotDate,
    start_time: startTime ?? null,
    end_time: endTime ?? null,
  };

  const { data, error } = await supabase
    .from("provider_blocked_slots")
    .insert(payload)
    .select("id, provider_id, slot_date, start_time, end_time, created_at")
    .single();

  if (error) throw error;
  return {
    id: data.id,
    providerId: data.provider_id,
    date: data.slot_date,
    time: data.start_time && data.end_time ? `${data.start_time}-${data.end_time}` : "journée entière",
    slotDate: data.slot_date,
    startTime: data.start_time,
    endTime: data.end_time,
    createdAt: data.created_at,
  };
}

/**
 * Delete a blocked slot. Only the owner (provider) can delete.
 */
export async function deleteBlockedSlot(slotId, providerId) {
  const { data, error } = await supabase
    .from("provider_blocked_slots")
    .delete()
    .eq("id", slotId)
    .eq("provider_id", providerId)
    .select("id")
    .single();

  if (error) throw error;
  return !!data;
}

/**
 * Check if a given date/time range overlaps any blocked slot for the provider.
 * @param {string} providerId
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} startTime - HH:mm
 * @param {string} endTime - HH:mm
 * @returns {Promise<boolean>} true if blocked (cannot book)
 */
export async function isSlotBlocked(providerId, dateStr, startTime, endTime) {
  const { data: blocks, error } = await supabase
    .from("provider_blocked_slots")
    .select("slot_date, start_time, end_time")
    .eq("provider_id", providerId)
    .eq("slot_date", dateStr);

  if (error) throw error;
  if (!blocks || blocks.length === 0) return false;

  const reqStart = timeToMinutes(startTime || "00:00");
  const reqEnd = timeToMinutes(endTime || "23:59");

  for (const b of blocks) {
    if (b.start_time == null && b.end_time == null) return true; // full-day block
    const blockStart = timeToMinutes(b.start_time || "00:00");
    const blockEnd = timeToMinutes(b.end_time || "23:59");
    if (reqStart < blockEnd && reqEnd > blockStart) return true;
  }
  return false;
}

function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
