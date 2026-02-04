// src/services/booking.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { refundPayment } from "./payment.service.js";
import { sendNotificationToUser } from "./onesignal.service.js";

export async function getBookings({ userId, scope, status }) {
  console.log("🔍 [BOOKINGS SERVICE] getBookings called with:", { userId, scope, status });
  
  let query = supabase.from("bookings").select("*");

  if (scope === "customer") {
    if (!userId) {
      console.error("❌ [BOOKINGS SERVICE] userId is missing for customer scope!");
      throw new Error("userId is required for customer scope");
    }
    console.log("✅ [BOOKINGS SERVICE] Filtering by customer_id:", userId);
    query.eq("customer_id", userId);
  }

  if (scope === "provider") {
    const { data: provider, error: providerError } = await supabase
      .from("provider_profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (providerError) throw providerError;
    if (!provider) return [];
    query.eq("provider_id", provider.user_id);
  }

  if (status) {
    query.eq("status", status);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;

  console.log(`✅ [BOOKINGS SERVICE] Found ${data?.length || 0} bookings for userId: ${userId}, scope: ${scope}`);
  if (data && data.length > 0 && scope === "customer") {
    // Vérifier que toutes les réservations appartiennent bien au customer
    const allBelongToCustomer = data.every(booking => booking.customer_id === userId);
    if (!allBelongToCustomer) {
      console.error("❌ [BOOKINGS SERVICE] Some bookings don't belong to the customer!", {
        userId,
        bookingCustomerIds: data.map(b => b.customer_id)
      });
    }
  }

  const bookingsWithServices = await Promise.all(
    data.map(async booking => {
      const { data: services } = await supabase
        .from("booking_services")
        .select("service_id, service_name, service_price")
        .eq("booking_id", booking.id);

      return {
        ...booking,
        services: services || [],
        servicesCount: services?.length || 0,
      };
    })
  );

  return bookingsWithServices;
}

export async function getBookingDetail(id) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  if (!data) return null;

  const { data: bookingServices, error: servicesError } = await supabase
    .from("booking_services")
    .select(
      `
        service_id,
        service_name,
        service_price,
        services (
          id,
          name,
          category,
          price,
          duration_minutes,
          description,
          image_url
        )
      `
    )
    .eq("booking_id", id);

  if (servicesError) {
    console.warn("[BOOKINGS] Error fetching booking services:", servicesError);
  }

  let customer = null;
  if (data.customer_id) {
    const { data: custProfile } = await supabase
      .from("customer_profiles")
      .select("first_name, last_name")
      .eq("user_id", data.customer_id)
      .maybeSingle();
    const { data: userRow } = await supabase
      .from("users")
      .select("email, phone")
      .eq("id", data.customer_id)
      .maybeSingle();
    if (custProfile || userRow) {
      customer = {
        firstName: custProfile?.first_name ?? "",
        lastName: custProfile?.last_name ?? "",
        email: userRow?.email ?? "",
        phone: userRow?.phone ?? "",
      };
    }
  }

  return {
    ...data,
    customer,
    services: bookingServices || [],
    servicesCount: bookingServices?.length || 0,
  };
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

/**
 * Auto-decline pending bookings not accepted before their acceptance_deadline.
 * Règles NIOS: >6h → 24h pour accepter; 3h–6h → 2h; 1h–3h → 30 min.
 * Refunds preauthorized payments, sets status to "declined", notifies customer.
 */
export async function cleanupExpiredBookings() {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: pendingBookings, error: fetchError } = await supabase
    .from("bookings")
    .select("id, payment_intent_id, payment_status, acceptance_deadline, created_at, customer_id")
    .eq("status", "pending")
    .in("payment_status", ["preauthorized", "paid"]);

  if (fetchError) throw fetchError;
  if (!pendingBookings || pendingBookings.length === 0) {
    return 0;
  }

  const expiredBookings = pendingBookings.filter((b) => {
    if (b.acceptance_deadline) {
      return new Date(b.acceptance_deadline) < now;
    }
    return new Date(b.created_at) < twentyFourHoursAgo;
  });

  if (expiredBookings.length === 0) {
    return 0;
  }

  for (const booking of expiredBookings) {
    if (booking.payment_intent_id && (booking.payment_status === "preauthorized" || booking.payment_status === "paid")) {
      try {
        await refundPayment(booking.payment_intent_id);
      } catch (err) {
        console.error(
          `[CLEANUP] Failed to refund booking ${booking.id}:`,
          err
        );
      }
    }

    await supabase
      .from("bookings")
      .update({
        status: "declined",
        payment_status: booking.payment_intent_id ? "refunded" : "pending",
      })
      .eq("id", booking.id);

    if (booking.customer_id) {
      try {
        await sendNotificationToUser({
          userId: booking.customer_id,
          title: "Réservation annulée",
          message: "Le détaileur n'a pas pu accepter votre demande à temps. Votre préautorisation a été annulée et aucun prélèvement ne sera effectué.",
        });
      } catch (notifErr) {
        console.error(`[CLEANUP] Failed to notify customer ${booking.customer_id}:`, notifErr);
      }
    }
  }

  return expiredBookings.length;
}
