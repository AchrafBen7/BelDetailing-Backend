// src/services/booking.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { refundPayment } from "./payment.service.js";
import { sendNotificationToUser } from "./onesignal.service.js";

export async function getBookings({ userId, scope, status }) {
  // 🔒 SECURITY: Si pas de scope, forcer le filtrage par userId pour ne pas retourner TOUS les bookings
  if (!scope) {
    console.warn("⚠️ [BOOKINGS SERVICE] No scope provided, defaulting to userId filter");
  }
  
  let query = supabase.from("bookings").select("*");

  if (scope === "customer") {
    if (!userId) {
      console.error("❌ [BOOKINGS SERVICE] userId is missing for customer scope!");
      throw new Error("userId is required for customer scope");
    }
    query.eq("customer_id", userId);
  } else if (scope === "provider") {
    const { data: provider, error: providerError } = await supabase
      .from("provider_profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (providerError) throw providerError;
    if (!provider) return [];
    query.eq("provider_id", provider.user_id);
  } else if (userId) {
    // 🔒 Pas de scope fourni : filtrer par customer_id OU provider_id pour cet utilisateur
    // (ne JAMAIS retourner tous les bookings de la plateforme)
    const { data: provider } = await supabase
      .from("provider_profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (provider) {
      query.or(`customer_id.eq.${userId},provider_id.eq.${provider.user_id}`);
    } else {
      query.eq("customer_id", userId);
    }
  }

  if (status) {
    query.eq("status", status);
  }

  const { data: rawData, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;

  // Exclure les bookings "fantômes" : pending avec payment_status pending ou failed
  // Ce sont des réservations où le paiement n'a jamais abouti (abandon Apple Pay, etc.)
  const data = (rawData || []).filter(booking => {
    if (booking.status === "pending" && (booking.payment_status === "pending" || booking.payment_status === "failed")) {
      return false; // Exclure
    }
    return true;
  });

  console.log(`✅ [BOOKINGS SERVICE] Found ${data.length} bookings for userId: ${userId}, scope: ${scope} (filtered from ${rawData?.length || 0})`);
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



// 🔒 SECURITY: Whitelist des champs autorisés pour les mises à jour externes
const BOOKING_UPDATABLE_FIELDS = new Set([
  "status",
  "payment_status",
  "payment_intent_id",
  "deposit_payment_intent_id",
  "date",
  "start_time",
  "end_time",
  "address",
  "invoice_sent",
  "acceptance_deadline",
  "customer_address_lat",
  "customer_address_lng",
  "at_provider",
  "notes",
]);

// Champs INTERDITS (ne doivent jamais être modifiables via PATCH public) :
// price, total_price, commission_rate, commission_amount, transport_fee,
// transport_distance_km, provider_id, customer_id, service_id

export async function updateBookingService(id, dataUpdate) {
  // 🔒 Filtrer uniquement les champs autorisés
  const sanitized = {};
  for (const [key, value] of Object.entries(dataUpdate)) {
    if (BOOKING_UPDATABLE_FIELDS.has(key)) {
      sanitized[key] = value;
    }
  }

  if (Object.keys(sanitized).length === 0) {
    // Rien à mettre à jour après filtrage
    const { data } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", id)
      .single();
    return data;
  }

  const { data, error } = await supabase
    .from("bookings")
    .update(sanitized)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

// 🔒 SECURITY: State machine pour les transitions de statut autorisées
const VALID_STATUS_TRANSITIONS = {
  pending:      ["confirmed", "cancelled", "declined"],
  confirmed:    ["started", "cancelled", "in_progress"],
  started:      ["in_progress", "completed", "cancelled"],
  in_progress:  ["completed", "cancelled"],
  completed:    ["refunded"],
  cancelled:    [],           // état terminal
  declined:     [],           // état terminal
  refunded:     [],           // état terminal
};

export function isValidStatusTransition(currentStatus, newStatus) {
  const allowed = VALID_STATUS_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(newStatus);
}

export async function updateBookingStatus(id, newStatus) {
  // D'abord vérifier l'état actuel
  const { data: current, error: fetchErr } = await supabase
    .from("bookings")
    .select("status")
    .eq("id", id)
    .single();

  if (fetchErr) throw fetchErr;
  if (!current) throw new Error("Booking not found");

  // Valider la transition
  if (!isValidStatusTransition(current.status, newStatus)) {
    const err = new Error(`Invalid status transition: '${current.status}' → '${newStatus}'`);
    err.statusCode = 400;
    throw err;
  }

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
    .select("id, payment_intent_id, deposit_payment_intent_id, payment_status, acceptance_deadline, created_at, customer_id")
    .eq("status", "pending")
    .in("payment_status", ["preauthorized", "paid", "pending"]);

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
    const intentToRefund = booking.payment_intent_id || booking.deposit_payment_intent_id;
    const shouldRefund = (booking.payment_status === "preauthorized" || booking.payment_status === "paid") && booking.payment_intent_id
      || (booking.payment_status === "pending" && booking.deposit_payment_intent_id);
    if (intentToRefund && shouldRefund) {
      try {
        await refundPayment(intentToRefund);
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
        payment_status: intentToRefund && shouldRefund ? "refunded" : "pending",
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
