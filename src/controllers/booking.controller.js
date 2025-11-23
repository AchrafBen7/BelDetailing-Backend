// src/controllers/booking.controller.js
import {
  getBookings,
  getBookingDetail,
  createBookingService,
  updateBookingService,
  updateBookingStatus,
} from "../services/booking.service.js";

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
    const booking = await createBookingService(req.body, req.user);
    return res.status(201).json(booking);
  } catch (err) {
    console.error("[BOOKINGS] create error:", err);
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

