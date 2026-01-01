import {
  getBookings,
  getBookingDetail,
  updateBookingService,
  updateBookingStatus,
} from "../services/booking.service.js";

import {
  createPaymentIntent,
  refundPayment,
  capturePayment,
} from "../services/payment.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";

const COMMISSION_RATE = 0.10;
let providerProfilesSupportsIdColumn;

const DEFAULT_SERVICE_STEPS = [
  { id: "step_1", title: "Preparation", percentage: 10, is_completed: false, order: 1 },
  { id: "step_2", title: "Exterior cleaning", percentage: 25, is_completed: false, order: 2 },
  { id: "step_3", title: "Interior cleaning", percentage: 30, is_completed: false, order: 3 },
  { id: "step_4", title: "Finishing", percentage: 25, is_completed: false, order: 4 },
  { id: "step_5", title: "Final check", percentage: 10, is_completed: false, order: 5 },
];

function buildDefaultProgress(bookingId) {
  return {
    booking_id: bookingId,
    steps: DEFAULT_SERVICE_STEPS.map(step => ({ ...step })),
    current_step_index: 0,
    total_progress: 0,
  };
}

async function getProviderProfileIdForUser(userId) {
  const { data, error } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return data.id ?? data.user_id ?? null;
}

async function fetchProviderProfileByAnyId(identifier) {
  if (identifier == null) return null;

  if (providerProfilesSupportsIdColumn !== false) {
    const { data, error } = await supabase
      .from("provider_profiles")
      .select("*")
      .eq("id", identifier)
      .maybeSingle();

    if (error) {
      if (error.code === "42703") {
        providerProfilesSupportsIdColumn = false;
      } else {
        throw error;
      }
    } else if (data) {
      providerProfilesSupportsIdColumn = true;
      return data;
    }
  }

  const { data, error } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("user_id", identifier)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/* -----------------------------------------------------
   LIST BOOKINGS
----------------------------------------------------- */
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

/* -----------------------------------------------------
   GET BOOKING
----------------------------------------------------- */
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

/* -----------------------------------------------------
   CREATE BOOKING + AUTO STRIPE PAYMENT INTENT
----------------------------------------------------- */
export async function createBooking(req, res) {
  try {
    const customerId = req.user.id;
    const {
      provider_id,
      service_id,
      date,
      start_time,
      end_time,
      address,
    } = req.body;

    // 1) Fetch service
    const { data: service, error: serviceError } = await supabase
      .from("services")
      .select("*")
      .eq("id", service_id)
      .single();

    if (serviceError || !service) {
      return res.status(404).json({ error: "Service not found" });
    }

    if (service.provider_id !== provider_id) {
      return res.status(400).json({ error: "Service does not belong to this provider" });
    }

    // 2) Fetch provider info
    const provider = await fetchProviderProfileByAnyId(provider_id);

    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const price = service.price;
    const currency = service.currency || "eur";

    // 3) Create booking (WITHOUT payment yet)
    // 1) Insert booking
const { data: inserted, error: bookingError } = await supabase
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
  .select(`
  id,
  provider_id,
  customer_id,
  service_id,
  provider_name,
  service_name,
  price,
  currency,
  date,
  start_time,
  end_time,
  address,
  status,
  payment_status,
  payment_intent_id,
  commission_rate,
  invoice_sent,
  provider_banner_url,
  created_at
  `)
.single();

if (bookingError) throw bookingError;

// 2) Fetch customer for payment intent
const { data: customer, error: customerError } = await supabase
  .from("users")
  .select("id, email, phone, stripe_customer_id")
  .eq("id", customerId)
  .single();

if (customerError || !customer) {
  return res.status(404).json({ error: "Customer not found" });
}

// 3) Create payment intent
const intent = await createPaymentIntent({
  amount: price,
  currency,
  user: customer,
});

// 4) Update booking with payment intent
const { data: updatedBooking, error: updateErr } = await supabase
  .from("bookings")
  .update({
    payment_intent_id: intent.id,
    payment_status: "preauthorized"
  })
  .eq("id", inserted.id)
.select(`
  id,
  provider_id,
  customer_id,
  service_id,
  provider_name,
  service_name,
  price,
  currency,
  date,
  start_time,
  end_time,
  address,
  status,
  payment_status,
  payment_intent_id,
  commission_rate,
  invoice_sent,
  provider_banner_url,
  created_at
  `
)
.single();

if (updateErr) throw updateErr;

// 4) Return the updated booking (NEVER the old one)
return res.status(201).json({
  data: {
    booking: updatedBooking,
    clientSecret: intent.clientSecret
  }
});



  } catch (err) {
    console.error("[BOOKINGS] createBooking error:", err);
    return res.status(500).json({ error: "Could not create booking" });
  }
}

/* -----------------------------------------------------
   START SERVICE (provider)
----------------------------------------------------- */
export async function startService(req, res) {
  try {
    const bookingId = req.params.id;
    const userId = req.user.id;

    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can start services" });
    }

    const providerProfileId = await getProviderProfileIdForUser(userId);
    if (!providerProfileId) {
      return res.status(403).json({ error: "Provider profile not found" });
    }

    const booking = await getBookingDetail(bookingId);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.provider_id !== providerProfileId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (booking.status !== "confirmed") {
      return res.status(400).json({ error: "Booking must be confirmed to start" });
    }

    const progress = buildDefaultProgress(bookingId);

    const updated = await updateBookingService(bookingId, {
      status: "started",
      progress,
    });

    return res.json({ data: updated });
  } catch (err) {
    console.error("[BOOKINGS] startService error:", err);
    return res.status(500).json({ error: "Could not start service" });
  }
}

/* -----------------------------------------------------
   UPDATE SERVICE PROGRESS (provider)
----------------------------------------------------- */
export async function updateProgress(req, res) {
  try {
    const bookingId = req.params.id;
    const userId = req.user.id;
    const { step_id } = req.body;

    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can update progress" });
    }

    if (!step_id) {
      return res.status(400).json({ error: "Missing step_id" });
    }

    const providerProfileId = await getProviderProfileIdForUser(userId);
    if (!providerProfileId) {
      return res.status(403).json({ error: "Provider profile not found" });
    }

    const booking = await getBookingDetail(bookingId);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.provider_id !== providerProfileId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (booking.status !== "started" && booking.status !== "in_progress") {
      return res.status(400).json({ error: "Service not started" });
    }

    if (!booking.progress?.steps?.length) {
      return res.status(400).json({ error: "Service progress not initialized" });
    }

    const progress = { ...booking.progress };
    const steps = progress.steps.map(step => ({ ...step }));
    const stepIndex = steps.findIndex(step => step.id === step_id);

    if (stepIndex === -1) {
      return res.status(400).json({ error: "Step not found" });
    }

    steps[stepIndex].is_completed = true;

    const totalProgress = steps
      .filter(step => step.is_completed)
      .reduce((sum, step) => sum + Number(step.percentage || 0), 0);

    const nextIncompleteIndex = steps.findIndex(step => !step.is_completed);
    const currentStepIndex =
      nextIncompleteIndex !== -1 ? nextIncompleteIndex : steps.length - 1;

    const updatedProgress = {
      ...progress,
      steps,
      total_progress: totalProgress,
      current_step_index: currentStepIndex,
    };

    const newStatus =
      booking.status === "started" && totalProgress > 0
        ? "in_progress"
        : booking.status;

    const updated = await updateBookingService(bookingId, {
      status: newStatus,
      progress: updatedProgress,
    });

    return res.json({ data: updated });
  } catch (err) {
    console.error("[BOOKINGS] updateProgress error:", err);
    return res.status(500).json({ error: "Could not update progress" });
  }
}

/* -----------------------------------------------------
   COMPLETE SERVICE (provider)
----------------------------------------------------- */
export async function completeService(req, res) {
  try {
    const bookingId = req.params.id;
    const userId = req.user.id;

    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can complete services" });
    }

    const providerProfileId = await getProviderProfileIdForUser(userId);
    if (!providerProfileId) {
      return res.status(403).json({ error: "Provider profile not found" });
    }

    const booking = await getBookingDetail(bookingId);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.provider_id !== providerProfileId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const progress = booking.progress;
    if (!progress?.steps?.length) {
      return res.status(400).json({ error: "Service progress not initialized" });
    }

    const totalProgress = progress.steps
      .filter(step => step.is_completed)
      .reduce((sum, step) => sum + Number(step.percentage || 0), 0);

    if (totalProgress < 100) {
      return res.status(400).json({ error: "All steps must be completed" });
    }

    const updated = await updateBookingService(bookingId, {
      status: "completed",
      progress: {
        ...progress,
        total_progress: 100,
        current_step_index: progress.steps.length - 1,
      },
    });

    return res.json({ data: updated });
  } catch (err) {
    console.error("[BOOKINGS] completeService error:", err);
    return res.status(500).json({ error: "Could not complete service" });
  }
}

/* -----------------------------------------------------
   UPDATE BOOKING
----------------------------------------------------- */
export async function updateBooking(req, res) {
  try {
    const booking = await updateBookingService(req.params.id, req.body);
    return res.json(booking);
  } catch (err) {
    console.error("[BOOKINGS] update error:", err);
    return res.status(500).json({ error: "Could not update booking" });
  }
}

/* -----------------------------------------------------
   CANCEL BOOKING (customer/provider)
----------------------------------------------------- */
export async function cancelBooking(req, res) {
  try {
    const bookingId = req.params.id;
    const userId = req.user.id;

    const booking = await getBookingDetail(bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const isCustomer = booking.customer_id === userId;
    let isProvider = false;
    if (req.user.role === "provider") {
      const providerProfileId = await getProviderProfileIdForUser(userId);
      isProvider = providerProfileId
        ? booking.provider_id === providerProfileId
        : false;
    }

    if (!isCustomer && !isProvider) {
      return res.status(403).json({ error: "You are not allowed to cancel this booking" });
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

    // Must be provider
    if (req.user.role !== "provider") {
      return res.status(403).json({
        error: "Only providers can confirm bookings",
      });
    }

    const providerProfileId = await getProviderProfileIdForUser(userId);
    if (!providerProfileId) {
      return res.status(403).json({
        error: "Provider profile not found",
      });
    }

    // Fetch booking
    const booking = await getBookingDetail(bookingId);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Only the owner provider can confirm
    if (booking.provider_id !== providerProfileId) {
      return res.status(403).json({
        error: "You are not allowed to confirm this booking",
      });
    }

    // Payment must exist
    if (!booking.payment_intent_id) {
      return res.status(400).json({
        error: "No payment intent for this booking",
      });
    }

    // Must be a preauthorized booking
    if (booking.payment_status !== "preauthorized") {
      return res.status(400).json({
        error: "Booking is not in preauthorized state",
      });
    }

    // Optional check: confirm only if booking is <24h old
    const createdAt = new Date(booking.created_at);
    const hoursSinceCreation = (Date.now() - createdAt.getTime()) / 1000 / 3600;

    if (hoursSinceCreation > 24) {
      return res.status(400).json({
        error: "Confirmation window expired (24h)",
      });
    }

    // 🔥 Capture payment on Stripe
    const ok = await capturePayment(booking.payment_intent_id);
    if (!ok) {
      return res.status(500).json({ error: "Could not capture payment" });
    }

    // Update DB
    const { data: updated, error: updateErr } = await supabase
      .from("bookings")
      .update({
        status: "confirmed",
        payment_status: "paid",
      })
      .eq("id", bookingId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return res.json({
      success: true,
      data: updated,
    });

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

    const providerProfileId = await getProviderProfileIdForUser(userId);
    if (!providerProfileId) {
      return res.status(403).json({
        error: "Provider profile not found",
      });
    }

    const booking = await getBookingDetail(bookingId);

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.provider_id !== providerProfileId) {
      return res.status(403).json({
        error: "You are not allowed to decline this booking",
      });
    }

    // 🟧 IMPORTANT : si le paiement est pré-autorisé → on annule la pré-autorisation
    if (booking.payment_intent_id && booking.payment_status === "preauthorized") {
      const ok = await refundPayment(booking.payment_intent_id);

      if (!ok) {
        return res.status(500).json({
          error: "Could not refund preauthorized payment",
        });
      }
    }

    // On marque comme declined
    const updated = await updateBookingService(bookingId, {
      status: "declined",
      payment_status: booking.payment_intent_id ? "refunded" : "pending"
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[BOOKINGS] decline error:", err);
    return res.status(500).json({ error: "Could not decline booking" });
  }
}


export async function refundBooking(req, res) {
  try {
    const bookingId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole !== "provider" && userRole !== "admin") {
      return res.status(403).json({
        error: "Only providers or admins can refund bookings",
      });
    }

    const booking = await getBookingDetail(bookingId);

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (userRole === "provider") {
      const providerProfileId = await getProviderProfileIdForUser(userId);
      if (!providerProfileId || booking.provider_id !== providerProfileId) {
        return res.status(403).json({
          error: "You are not allowed to refund this booking",
        });
      }
    }

    if (!booking.payment_intent_id) {
      return res.status(400).json({
        error: "No payment_intent linked to this booking"
      });
    }

    const ok = await refundPayment(booking.payment_intent_id);

    if (!ok) {
      return res.status(500).json({ error: "Stripe refund failed" });
    }

    const updated = await updateBookingService(bookingId, {
      status: "cancelled",
      payment_status: "refunded"
    });

    return res.json({ success: true, data: updated });

  } catch (err) {
    console.error("[BOOKINGS] refund error:", err);
    return res.status(500).json({ error: "Could not refund booking" });
  }
}
