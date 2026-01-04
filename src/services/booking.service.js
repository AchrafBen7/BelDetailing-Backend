// src/services/booking.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

export async function getBookings({ userId, scope, status }) {
  let query = supabase.from("bookings").select("*");

  if (scope === "customer") {
    query.eq("customer_id", userId);
  }

  if (scope === "provider") {
    const { data: provider, error: providerError } = await supabase
      .from("provider_profiles")
      .select("id, user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (providerError) throw providerError;
    if (!provider) return [];

    const providerId = provider.id;
    const providerUserId = provider.user_id;

    if (providerId && providerUserId && providerId !== providerUserId) {
      query.or(`provider_id.eq.${providerId},provider_id.eq.${providerUserId}`);
    } else {
      query.eq("provider_id", providerId || providerUserId);
    }
  }

  if (status) {
    query.eq("status", status);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;

  return data;
}

export async function getBookingDetail(id) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function createBookingService(payload, customer) {
  const booking = {
    provider_id: payload.provider_id,
    service_id: payload.service_id,

    provider_name: payload.provider_name,
    service_name: payload.service_name,
    price: payload.price,

    date: payload.date,
    start_time: payload.start_time,
    end_time: payload.end_time,

    address: payload.address,

    status: payload.status ?? "pending",
    payment_status: payload.payment_status ?? "pending",
    payment_intent_id: payload.payment_intent_id ?? null,

    commission_rate: payload.commission_rate ?? null,
    invoice_sent: payload.invoice_sent ?? false,

    provider_banner_url: payload.provider_banner_url ?? null,

    // 👤 données client (auto depuis le JWT)
    customer_id: customer.id
  };

  const { data, error } = await supabase
    .from("bookings")
    .insert(booking)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}



export async function updateBookingService(id, dataUpdate) {
  const { data, error } = await supabase
    .from("bookings")
    .update(dataUpdate)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateBookingStatus(id, newStatus) {
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: newStatus })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return data ? true : false;
}
