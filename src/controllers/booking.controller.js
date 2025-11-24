// src/controllers/booking.controller.js
import {
  getBookings,
  getBookingDetail,
  createBookingService,
  updateBookingService,
  updateBookingStatus,
} from "../services/booking.service.js";

import { supabase } from "..//config/supabase.js";

const COMMISSION_RATE = 0.10;

export async function listBookings(req, res) {
  try {
    const { scope, status } = req.query;
    const userId = req.user.id;

    const items = await getBookings({ userId, scope, status });
    return res.json({ data: items });
  } catch (err) {
    console.error("[BOOKINGS] list error:", err);
    return res.status(500).json({ error: "Could not fetch bookings" });
  }
}

export async function getBooking(req, res) {
  try {
    const { id } = req.params;
    const booking = await getBookingDetail(id);

    return res.json(booking);
  } catch (err) {
    console.error("[BOOKINGS] get error:", err);
    return res.status(500).json({ error: "Could not fetch booking" });
  }
}

export async function createBooking(req, res) {
  try {
    const customerId = req.user.id; // user connecté (customer)
    const {
      provider_id,
      service_id,
      date,
      start_time,
      end_time,
      address,
    } = req.body;

    // 1) On récupère le service
    const { data: service, error: serviceError } = await supabase
      .from("services")
      .select("*")
      .eq("id", service_id)
      .single();

    if (serviceError || !service) {
      return res.status(404).json({ error: "Service not found" });
    }

    // sécurité : on vérifie que le service appartient bien à ce provider
    if (service.provider_id !== provider_id) {
      return res
        .status(400)
        .json({ error: "Service does not belong to this provider" });
    }

    // 2) On récupère le provider (nom, bannière, stripe_account_id, etc.)
    const { data: provider, error: providerError } = await supabase
      .from("provider_profiles")
      .select("display_name, banner_url, stripe_account_id")
      .eq("user_id", provider_id)
      .single();

    if (providerError || !provider) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const price = service.price;
    const currency = service.currency || "eur";

    // 3) On insère la booking en base
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        provider_id,
        customer_id: customerId,
        service_id,

        provider_name: provider.display_name,
        service_name: service.name,
        price,
        currency,

        date,
        start_time,
        end_time,
        address,

        status: "pending",
        payment_status: "pending",
        payment_intent_id: null,
        commission_rate: COMMISSION_RATE,
        invoice_sent: false,

        provider_banner_url: provider.banner_url ?? null,
      })
      .select()
      .single();

    if (bookingError) throw bookingError;

    return res.status(201).json({ data: booking });
  } catch (err) {
    console.error("[BOOKINGS] createBooking error:", err);
    return res.status(500).json({ error: "Could not create booking" });
  }
}

export async function updateBooking(req, res) {
  try {
    const booking = await updateBookingService(req.params.id, req.body);
    return res.json(booking);
  } catch (err) {
    console.error("[BOOKINGS] update error:", err);
    return res.status(500).json({ error: "Could not update booking" });
  }
}

export async function cancelBooking(req, res) {
  try {
    const bookingId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    // On récupère la réservation
    const booking = await getBookingDetail(bookingId);

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const isCustomer = booking.customer_id === userId;
    const isProvider = booking.provider_id === userId;

    // 👉 Seul le customer OU le provider lié au booking peut annuler
    if (!isCustomer && !isProvider) {
      return res.status(403).json({
        error: "You are not allowed to cancel this booking",
      });
    }

    const ok = await updateBookingStatus(bookingId, "cancelled");
    return res.json({ success: ok });
  } catch (err) {
    console.error("[BOOKINGS] cancel error:", err);
    return res.status(500).json({ error: "Could not cancel booking" });
  }
}


export async function confirmBooking(req, res) {
  try {
    const bookingId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole !== "provider") {
      return res.status(403).json({
        error: "Only providers can confirm bookings",
      });
    }

    const booking = await getBookingDetail(bookingId);

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // 👉 Seul le provider propriétaire du booking
    if (booking.provider_id !== userId) {
      return res.status(403).json({
        error: "You are not allowed to confirm this booking",
      });
    }

    const ok = await updateBookingStatus(bookingId, "confirmed");
    return res.json({ success: ok });
  } catch (err) {
    console.error("[BOOKINGS] confirm error:", err);
    return res.status(500).json({ error: "Could not confirm booking" });
  }
}


export async function declineBooking(req, res) {
  try {
    const bookingId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole !== "provider") {
      return res.status(403).json({
        error: "Only providers can decline bookings",
      });
    }

    const booking = await getBookingDetail(bookingId);

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.provider_id !== userId) {
      return res.status(403).json({
        error: "You are not allowed to decline this booking",
      });
    }

    const ok = await updateBookingStatus(bookingId, "declined");
    return res.json({ success: ok });
  } catch (err) {
    console.error("[BOOKINGS] decline error:", err);
    return res.status(500).json({ error: "Could not decline booking" });
  }
}

