import {
  getBookings,
  getBookingDetail,
  updateBookingService,
  updateBookingStatus,
  cleanupExpiredBookings,
} from "../services/booking.service.js";

import {
  createPaymentIntent,
  refundPayment,
  capturePayment,
  getChargeIdFromPaymentIntent,
} from "../services/payment.service.js";
import { sendNotificationToUser, sendNotificationWithDeepLink } from "../services/onesignal.service.js";
import { sendPeppolInvoice } from "../services/peppol.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { BOOKING_COMMISSION_RATE } from "../config/commission.js";

const COMMISSION_RATE = BOOKING_COMMISSION_RATE; // 10% pour les bookings
const NIOS_MANAGEMENT_FEE_RATE = 0.05; // 5% frais de gestion NIOS (annulation)
const NIOS_MANAGEMENT_FEE_MIN = 10.0; // Minimum 10€ de frais de gestion (annulation)
let providerProfilesSupportsIdColumn;

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const dLat = degreesToRadians(lat2 - lat1);
  const dLng = degreesToRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degreesToRadians(lat1)) *
      Math.cos(degreesToRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function calculateTransportFeeByZone(distanceKm) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return 0;
  }
  if (distanceKm > 25) {
    return 20.0;
  }
  if (distanceKm > 10) {
    return 15.0;
  }
  return 0.0;
}

function buildBookingDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  const isoString = `${dateValue}T${timeValue}`;
  const parsed = new Date(isoString);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Règles d'acceptation NIOS (délai min, dernière minute, délai pour accepter).
 * - < 1h avant début → interdit
 * - 1h–3h → autorisé mais "express", délai acceptation 30 min
 * - 3h–6h → délai acceptation 2h
 * - > 6h → délai acceptation 24h
 */
function getAcceptanceRules(dateStr, startTimeStr) {
  const serviceStart = buildBookingDateTime(dateStr, startTimeStr);
  if (!serviceStart) {
    return { allowed: false, errorMessage: "Date ou heure de début invalide." };
  }
  const now = new Date();
  const hoursFromNow = (serviceStart.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Date/heure déjà passée → refus explicite
  if (hoursFromNow < 0) {
    return {
      allowed: false,
      errorMessage: "La date et l'heure choisies sont déjà passées. Veuillez sélectionner un créneau à venir.",
    };
  }
  // Moins d'1 h avant le début → interdit (règle NIOS)
  if (hoursFromNow < 1) {
    return {
      allowed: false,
      errorMessage: "Les réservations doivent être faites au minimum 1 heure à l'avance.",
    };
  }

  let acceptanceDeadline;
  let isExpressRequest = false;
  if (hoursFromNow >= 6) {
    acceptanceDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  } else if (hoursFromNow >= 3) {
    acceptanceDeadline = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  } else {
    // 1h–3h: demande express, 30 min pour accepter
    acceptanceDeadline = new Date(now.getTime() + 30 * 60 * 1000);
    isExpressRequest = true;
  }

  return {
    allowed: true,
    acceptanceDeadline: acceptanceDeadline.toISOString(),
    isExpressRequest,
  };
}

/**
 * Calcule le montant remboursable selon la politique NIOS.
 * Frais NIOS = 5% du prix du SERVICE uniquement (pas du total), minimum 10€.
 *
 * - Plus de 48h: 100% remboursé.
 * - 24h-48h: Remboursement = total - frais NIOS (5% du service, min 10€). Transport remboursé.
 * - Moins de 24h: Transport gardé par le détaileur. Remboursement = service - frais NIOS (5% du service, min 10€).
 *   Ex: 300€ service + 20€ transport → frais NIOS = 15€ (5% de 300), remboursé = 285€.
 */
function calculateRefundAmount(booking, hoursUntilBooking) {
  const totalPrice = booking.price || 0;
  const transportFee = booking.transport_fee || 0;
  const servicePrice = totalPrice - transportFee;

  // Frais NIOS = 5% du prix du service uniquement, minimum 10€
  const niosFeeFromService = Math.max(
    servicePrice * NIOS_MANAGEMENT_FEE_RATE,
    NIOS_MANAGEMENT_FEE_MIN
  );

  // 🟢 Plus de 48h avant: remboursement intégral (100%)
  if (hoursUntilBooking >= 48) {
    return {
      refundAmount: totalPrice,
      retainedAmount: 0,
      retainedItems: {
        niosFee: 0,
        transportFee: 0,
      },
    };
  }

  // 🟡 Entre 24h et 48h: Service + Transport - Frais NIOS (5% du service)
  if (hoursUntilBooking >= 24) {
    const refundAmount = totalPrice - niosFeeFromService;

    return {
      refundAmount: Math.max(0, refundAmount),
      retainedAmount: niosFeeFromService,
      retainedItems: {
        niosFee: niosFeeFromService,
        transportFee: 0,
      },
    };
  }

  // 🔴 Moins de 24h: Transport gardé par le détaileur. Remboursement = service - 5% du service.
  const refundAmount = servicePrice - niosFeeFromService;

  return {
    refundAmount: Math.max(0, refundAmount),
    retainedAmount: transportFee + niosFeeFromService,
    retainedItems: {
      niosFee: niosFeeFromService,
      transportFee: transportFee, // gardé par le détaileur
    },
  };
}

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

async function getProviderProfileIdsForUser(userId) {
  const { data, error } = await supabase
    .from("provider_profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: null,
    userId: data.user_id ?? null,
  };
}

function isBookingOwnedByProvider(booking, providerProfile) {
  if (!booking || !providerProfile) return false;
  return (
    booking.provider_id === providerProfile.id ||
    booking.provider_id === providerProfile.userId
  );
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
    const userId = req.user?.id;

    console.log("🔍 [BOOKINGS CONTROLLER] listBookings called with:", {
      userId,
      scope,
      status,
      hasUser: !!req.user,
      userEmail: req.user?.email
    });

    if (!userId) {
      console.error("❌ [BOOKINGS CONTROLLER] req.user.id is missing!");
      return res.status(401).json({ error: "User ID is missing" });
    }

    const items = await getBookings({ userId, scope, status });
    console.log(`✅ [BOOKINGS CONTROLLER] Returning ${items?.length || 0} bookings`);
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
    console.log("🔵 [BOOKINGS] createBooking START - Body:", JSON.stringify(req.body, null, 2));
    const customerId = req.user.id;
    const {
      provider_id,
      service_id,
      service_ids,
      date,
      start_time,
      end_time,
      address,
      service_at_provider, // true = au garage du détaileur, false = à l'adresse du client (mobile)
      payment_method,
      customer_address_lat,
      customer_address_lng,
      transport_fee, // ⚠️ Peut être envoyé par l'app
      transport_distance_km, // ⚠️ Peut être envoyé par l'app
      // Peppol fields
      peppol_requested,
      company_name,
      company_vat,
      company_address,
      company_peppol_id,
    } = req.body;

    console.log("🔵 [BOOKINGS] createBooking - customerId:", customerId);
    console.log("🔵 [BOOKINGS] createBooking - service_id:", service_id);
    console.log("🔵 [BOOKINGS] createBooking - provider_id:", provider_id);

    let serviceIdsToBook = [];

    if (Array.isArray(service_ids) && service_ids.length > 0) {
      serviceIdsToBook = service_ids;
    } else if (service_id) {
      serviceIdsToBook = [service_id];
    } else {
      return res.status(400).json({ error: "Missing service_id or service_ids" });
    }

    // 1) Fetch services
    console.log("🔵 [BOOKINGS] createBooking - Fetching services with IDs:", serviceIdsToBook);
    const { data: services, error: servicesError } = await supabase
      .from("services")
      .select("*")
      .in("id", serviceIdsToBook);

    if (servicesError) {
      console.error("❌ [BOOKINGS] createBooking - Services fetch error:", servicesError);
      return res.status(500).json({ error: "Could not fetch services", details: servicesError.message });
    }

    if (!services || services.length === 0) {
      console.error("❌ [BOOKINGS] createBooking - No services found for IDs:", serviceIdsToBook);
      return res.status(404).json({ error: "Services not found" });
    }

    console.log("✅ [BOOKINGS] createBooking - Services fetched:", services.length);

    const allFromSameProvider = services.every(
      service => service.provider_id === provider_id
    );

    if (!allFromSameProvider) {
      return res
        .status(400)
        .json({ error: "All services must belong to the same provider" });
    }

    // 2) Fetch provider info
    const provider = await fetchProviderProfileByAnyId(provider_id);

    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const hasGarage = provider.has_garage === true;
    const hasMobile = provider.has_mobile_service === true;
    let atProvider = service_at_provider === true;

    if (hasGarage && !hasMobile) {
      atProvider = true;
    } else if (!hasGarage && hasMobile) {
      atProvider = false;
      if (!address || String(address).trim() === "" || String(address).toLowerCase().includes("à préciser")) {
        return res.status(400).json({ error: "Address is required for mobile service." });
      }
    } else if (hasGarage && hasMobile) {
      if (!atProvider && (!address || String(address).trim() === "" || String(address).toLowerCase().includes("à préciser"))) {
        return res.status(400).json({ error: "Address is required when choosing mobile service." });
      }
    }

    // ✅ Règles NIOS: min 1h avant début, délai d'acceptation selon créneau (24h / 2h / 30 min)
    const acceptanceRules = getAcceptanceRules(date, start_time);
    if (!acceptanceRules.allowed) {
      return res.status(400).json({ error: acceptanceRules.errorMessage });
    }
    const { acceptanceDeadline, isExpressRequest } = acceptanceRules;

    // ✅ Vérifier le plafond annuel pour les provider_passionate
    const { data: providerUser, error: providerUserError } = await supabase
      .from("users")
      .select("role")
      .eq("id", provider_id)
      .single();
    
    if (!providerUserError && providerUser?.role === "provider_passionate") {
      const { data: providerProfile, error: profileError } = await supabase
        .from("provider_profiles")
        .select("annual_revenue_limit, annual_revenue_current, annual_revenue_year")
        .eq("user_id", provider_id)
        .single();
      
      if (!profileError && providerProfile) {
        const currentYear = new Date().getFullYear();
        const isNewYear = providerProfile.annual_revenue_year !== currentYear;
        
        // Réinitialiser si nouvelle année
        if (isNewYear) {
          await supabase
            .from("provider_profiles")
            .update({
              annual_revenue_current: 0,
              annual_revenue_year: currentYear,
            })
            .eq("user_id", provider_id);
          
          providerProfile.annual_revenue_current = 0;
          providerProfile.annual_revenue_year = currentYear;
        }
        
        // Calculer le nouveau revenu avec ce booking
        const servicesTotalPrice = services.reduce(
          (sum, service) => sum + Number(service.price || 0),
          0
        );
        const newRevenue = (providerProfile.annual_revenue_current || 0) + servicesTotalPrice;
        const limit = providerProfile.annual_revenue_limit || 2000; // ✅ Plafond à 2000€
        
        if (newRevenue > limit) {
          return res.status(403).json({
            error: `Annual revenue limit reached (${limit}€). Please upgrade to Pro account (VAT required) to continue.`
          });
        }
      }
    }

    const servicesTotalPrice = services.reduce(
      (sum, service) => sum + Number(service.price || 0),
      0
    );
    const currency = services[0]?.currency || "eur";

    const providerLat = provider.lat;
    const providerLng = provider.lng;
    const customerAddressLat =
      customer_address_lat != null ? Number(customer_address_lat) : null;
    const customerAddressLng =
      customer_address_lng != null ? Number(customer_address_lng) : null;

    let transportDistanceKm = null;
    let transportFee = 0;

    // ⚠️ Utiliser les valeurs envoyées par l'app si présentes, sinon calculer
    if (transport_distance_km != null && transport_fee != null) {
      console.log("🔵 [BOOKINGS] createBooking - Using transport values from request");
      transportDistanceKm = Number(transport_distance_km);
      transportFee = Number(transport_fee);
    } else if (!provider.has_mobile_service || atProvider) {
      transportDistanceKm = null;
      transportFee = 0;
    } else if (
      providerLat != null &&
      providerLng != null &&
      customerAddressLat != null &&
      customerAddressLng != null
    ) {
      console.log("🔵 [BOOKINGS] createBooking - Calculating transport values");
      transportDistanceKm = calculateDistanceKm(
        Number(providerLat),
        Number(providerLng),
        customerAddressLat,
        customerAddressLng
      );
      transportFee = calculateTransportFeeByZone(transportDistanceKm);
    }

    console.log("🔵 [BOOKINGS] createBooking - Transport distance (km):", transportDistanceKm);
    console.log("🔵 [BOOKINGS] createBooking - Transport fee:", transportFee);

    // ✅ VÉRIFIER OFFRE DE BIENVENUE
    // 1) Vérifier si le customer a déjà utilisé son offre (on récupère customer plus bas, donc on fait une requête séparée)
    const { data: customerCheckData, error: customerCheckError } = await supabase
      .from("users")
      .select("welcoming_offer_used")
      .eq("id", customerId)
      .single();

    const hasUsedWelcomingOffer = customerCheckData?.welcoming_offer_used === true;

    // 2) Vérifier si c'est le premier booking confirmé du customer
    const { data: previousConfirmedBookings, error: previousBookingsError } = await supabase
      .from("bookings")
      .select("id")
      .eq("customer_id", customerId)
      .eq("status", "confirmed")
      .limit(1);

    const isFirstBooking = !hasUsedWelcomingOffer && 
                           (!previousConfirmedBookings || previousConfirmedBookings.length === 0);

    // 3) Vérifier si le provider participe à l'offre
    const providerParticipates = provider.welcoming_offer_enabled === true;

    // 4) Calculer l'offre de bienvenue
    let welcomingOfferAmount = 0;
    let welcomingOfferApplied = false;
    const WELCOMING_OFFER_MAX = 20.0; // Plafond 20€

    if (isFirstBooking && providerParticipates && transportFee > 0) {
      // CAS 1: Detailer AVEC frais de transport → frais offerts (max 20€)
      welcomingOfferAmount = Math.min(transportFee, WELCOMING_OFFER_MAX);
      welcomingOfferApplied = true;
      console.log("🎁 [BOOKINGS] Welcoming offer applied:", welcomingOfferAmount, "€");
    } else if (isFirstBooking && providerParticipates && transportFee === 0) {
      // CAS 2: Detailer SANS frais de transport → pas de réduction financière, juste badge
      welcomingOfferApplied = true;
      welcomingOfferAmount = 0;
      console.log("🎁 [BOOKINGS] Welcoming offer eligible (no transport fee, badge only)");
    }

    // 5) Calculer le prix total avec l'offre
    const totalPriceBeforeOffer = servicesTotalPrice + transportFee;
    const totalPrice = totalPriceBeforeOffer - welcomingOfferAmount;
    const paymentMethod = payment_method || "card";
    const serviceNames = services.map(service => service.name).join(", ");

    // ✅ Capacité selon team_size : au plus (team_size) réservations qui se chevauchent sur ce créneau
    const teamSize = Math.max(1, Number(provider.team_size) || 1);
    const providerIdsToCheck = [provider_id, provider.id, provider.user_id].filter(Boolean);
    const { data: existingSameSlot, error: overlapError } = await supabase
      .from("bookings")
      .select("id, start_time, end_time")
      .in("provider_id", [...new Set(providerIdsToCheck)])
      .eq("date", date)
      .in("status", ["pending", "confirmed", "started", "in_progress", "ready_soon"]);

    if (!overlapError && existingSameSlot) {
      const toMin = (t) => {
        if (!t || typeof t !== "string") return 0;
        const [h, m] = t.split(":").map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      const newStart = toMin(start_time);
      const newEnd = toMin(end_time);
      const overlappingCount = existingSameSlot.filter((b) => {
        const s = toMin(b.start_time);
        const e = toMin(b.end_time);
        return newStart < e && newEnd > s;
      }).length;
      if (overlappingCount >= teamSize) {
        return res.status(409).json({
          error: "This time slot is no longer available for this provider. Please choose another date or time.",
        });
      }
    }

    // 3) Create booking (WITHOUT payment yet)
    console.log("🔵 [BOOKINGS] createBooking - Creating booking record...");
    // 1) Insert booking
    const { data: inserted, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        provider_id,
        customer_id: customerId,
        service_id: serviceIdsToBook[0],

        provider_name: provider.display_name,
        service_name: serviceNames,
        price: totalPrice,
        currency,

        date,
        start_time,
        end_time,
        address,

        status: "pending",
        payment_status: "pending",
        payment_intent_id: null,
        payment_method: paymentMethod,
        deposit_amount: null,
        deposit_payment_intent_id: null,
        commission_rate: COMMISSION_RATE,
        invoice_sent: false,
        provider_banner_url: provider.banner_url ?? null,
        transport_distance_km: transportDistanceKm,
        transport_fee: transportFee,
        customer_address_lat: customerAddressLat,
        customer_address_lng: customerAddressLng,
        service_at_provider: atProvider,
        // Peppol fields
        peppol_requested: peppol_requested === true,
        peppol_status: peppol_requested === true ? "pending" : null,
        company_name: company_name || null,
        company_vat: company_vat || null,
        company_address: company_address || null,
        company_peppol_id: company_peppol_id || null,
        // Welcoming offer fields
        is_first_booking: isFirstBooking,
        welcoming_offer_applied: welcomingOfferApplied,
        welcoming_offer_amount: welcomingOfferAmount,
        // Règles d'acceptation (délai détaileur, demande express)
        acceptance_deadline: acceptanceDeadline,
        is_express_request: isExpressRequest,
      })
      .select(`
        id,
        provider_id,
        customer_id,
        service_id,
        provider_name,
        service_name,
        price,
        transport_distance_km,
        transport_fee,
        customer_address_lat,
        customer_address_lng,
        currency,
        date,
        start_time,
        end_time,
        address,
        status,
        payment_status,
        payment_intent_id,
        payment_method,
        deposit_amount,
        deposit_payment_intent_id,
        commission_rate,
        invoice_sent,
        provider_banner_url,
        created_at
      `)
      .single();

    if (bookingError) {
      console.error("❌ [BOOKINGS] createBooking - Booking insert error:", bookingError);
      console.error("❌ [BOOKINGS] createBooking - Booking insert error details:", JSON.stringify(bookingError, null, 2));
      throw bookingError;
    }

    console.log("✅ [BOOKINGS] createBooking - Booking created with ID:", inserted.id);

    // Insertion optionnelle dans booking_services (pour multi-services)
    // Si la table n'existe pas ou s'il y a une erreur, on continue quand même
    const bookingServicesData = services.map(service => ({
      booking_id: inserted.id,
      service_id: service.id,
      service_name: service.name,
      service_price: service.price,
    }));

    try {
      const { error: bookingServicesError } = await supabase
        .from("booking_services")
        .insert(bookingServicesData);

      if (bookingServicesError) {
        console.warn(
          "[BOOKINGS] booking_services insert failed (non-blocking):",
          bookingServicesError.message
        );
        // ⚠️ On ne bloque PAS le flux si booking_services échoue
        // Le booking principal est déjà créé, on continue
      } else {
        console.log(
          "[BOOKINGS] booking_services inserted successfully for booking:",
          inserted.id
        );
      }
    } catch (err) {
      console.warn(
        "[BOOKINGS] booking_services insert exception (non-blocking):",
        err.message
      );
      // Continue même si booking_services échoue
    }

    // 2) Fetch customer for payment intent
    console.log("🔵 [BOOKINGS] createBooking - Fetching customer:", customerId);
    const { data: customer, error: customerError } = await supabase
      .from("users")
      .select("id, email, phone, stripe_customer_id")
      .eq("id", customerId)
      .single();

    if (customerError) {
      console.error("❌ [BOOKINGS] createBooking - Customer fetch error:", customerError);
      return res.status(500).json({ error: "Could not fetch customer", details: customerError.message });
    }

    if (!customer) {
      console.error("❌ [BOOKINGS] createBooking - Customer not found:", customerId);
      return res.status(404).json({ error: "Customer not found" });
    }

    console.log("✅ [BOOKINGS] createBooking - Customer fetched:", customer.email);

    // ✅ Récupérer le Stripe Connect account du provider (si disponible)
    const { data: providerProfile, error: providerProfileError } = await supabase
      .from("provider_profiles")
      .select("stripe_account_id")
      .eq("user_id", provider_id)
      .maybeSingle();
    
    const providerStripeAccountId = providerProfile?.stripe_account_id || null;
    
    // ✅ Réutiliser providerUser déclaré plus haut (ligne 329) pour éviter la duplication
    // Le rôle a déjà été récupéré pour vérifier le plafond annuel des provider_passionate
    
    // Commission NIOS : 10% pour tous (passionnés et pros)
    const commissionRate = COMMISSION_RATE; // 0.10 (10%)

    console.log("🔵 [BOOKINGS] createBooking - Creating payment intent...");
    console.log("🔵 [BOOKINGS] createBooking - Payment method:", paymentMethod);
    console.log("🔵 [BOOKINGS] createBooking - Total price:", totalPrice);
    console.log("🔵 [BOOKINGS] createBooking - Provider Stripe Account:", providerStripeAccountId || "none");
    console.log("🔵 [BOOKINGS] createBooking - Provider role:", providerUser?.role || "unknown");
    
    let intent = null;
    if (paymentMethod === "cash") {
      const depositAmount = Math.round(totalPrice * 0.2 * 100) / 100;
      const commissionOnTotal = Math.round(totalPrice * commissionRate * 100) / 100; // 10% du prix total, pas de l'acompte
      console.log("🔵 [BOOKINGS] createBooking - Creating deposit payment intent:", depositAmount, "| Commission 10% sur total:", commissionOnTotal);
      intent = await createPaymentIntent({
        amount: depositAmount,
        currency,
        user: customer,
        providerStripeAccountId,
        commissionRate,
        commissionAmount: commissionOnTotal, // ✅ 10% du prix total (pas 10% des 20% acompte)
      });
    } else {
      // Carte : capture sur la plateforme, transfert au détaileur 3h après l'heure de résa (cron)
      console.log("🔵 [BOOKINGS] createBooking - Creating full payment intent (delayed transfer):", totalPrice);
      intent = await createPaymentIntent({
        amount: totalPrice,
        currency,
        user: customer,
        providerStripeAccountId,
        commissionRate: COMMISSION_RATE,
        delayTransferToProvider: true, // argent détaileur gelé jusqu'à 3h après date+heure résa
      });
    }

    console.log("✅ [BOOKINGS] createBooking - Payment intent created:", intent?.id);

    // 4) Update booking with payment intent
    const { data: updatedBooking, error: updateErr } = await supabase
      .from("bookings")
      .update({
        payment_intent_id: paymentMethod === "cash" ? null : intent.id,
        deposit_payment_intent_id: paymentMethod === "cash" ? intent.id : null,
        deposit_amount: paymentMethod === "cash" ? intent.amount : null,
        payment_status: paymentMethod === "cash" ? "pending" : "preauthorized",
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
        transport_distance_km,
        transport_fee,
        customer_address_lat,
        customer_address_lng,
        currency,
        date,
        start_time,
        end_time,
        address,
        status,
        payment_status,
        payment_intent_id,
        payment_method,
        deposit_amount,
        deposit_payment_intent_id,
        commission_rate,
        invoice_sent,
        provider_banner_url,
        is_first_booking,
        welcoming_offer_applied,
        welcoming_offer_amount,
        created_at
      `)
      .single();

    if (updateErr) throw updateErr;

    // ✅ ENVOYER NOTIFICATION AU PROVIDER (nouvelle réservation créée)
    try {
      // ⚠️ IMPORTANT : OneSignal utilise external_user_id qui correspond au user_id (users.id)
      // provider.user_id = le vrai ID de l'utilisateur dans la table users
      // provider_id peut être provider_profiles.id ou user_id selon le contexte
      const providerUserId = provider.user_id || provider_id;

      // Récupérer les infos du customer pour le message (customer est déjà récupéré plus haut)
      const { data: customerProfile } = await supabase
        .from("customer_profiles")
        .select("first_name, last_name")
        .eq("user_id", customerId)
        .maybeSingle();
      
      const customerName = customerProfile
        ? `${customerProfile.first_name || ""} ${customerProfile.last_name || ""}`.trim() || customer.email?.split("@")[0] || "Un client"
        : customer.email?.split("@")[0] || "Un client";

      // ✅ Utiliser sendNotificationWithDeepLink pour améliorer le routing iOS
      await sendNotificationWithDeepLink({
        userId: providerUserId, // ✅ Utiliser user_id pour OneSignal (external_user_id)
        title: "Nouvelle demande de réservation",
        message: `${customerName} souhaite réserver ${serviceNames}`,
        type: "booking_created",
        id: updatedBooking.id.toString(),
        // Deep link automatique: beldetailing://booking_created/{booking_id}
      });
    } catch (notifError) {
      console.error("[BOOKINGS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer la création de booking si la notification échoue
    }

    // 4) Return the updated booking (NEVER the old one)
    return res.status(201).json({
      data: {
        booking: updatedBooking,
        clientSecret: intent?.clientSecret ?? null,
        services: services.map(service => ({
          id: service.id,
          name: service.name,
          price: service.price,
          durationMinutes: service.duration_minutes,
        })),
      },
    });



  } catch (err) {
    console.error("[BOOKINGS] createBooking error:", err);
    console.error("[BOOKINGS] createBooking error stack:", err.stack);
    console.error("[BOOKINGS] createBooking error message:", err.message);
    return res.status(500).json({ 
      error: "Could not create booking",
      details: err.message,
      // ⚠️ En production, ne pas exposer le stack, mais pour debug c'est utile
      // stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
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

    // ✅ ENVOYER NOTIFICATION AU CUSTOMER (service démarré)
    try {
      await sendNotificationToUser({
        userId: booking.customer_id, // Customer reçoit la notification
        title: "Service démarré",
        message: `${booking.provider_name || "Le prestataire"} a commencé le service ${booking.service_name || ""}`,
        data: {
          type: "service_started",
          booking_id: bookingId,
          provider_id: booking.provider_id,
        },
      });
    } catch (notifError) {
      console.error("[BOOKINGS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer le démarrage si la notification échoue
    }

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

    // ✅ ENVOYER NOTIFICATION AU CUSTOMER (progression service)
    // Notifier seulement pour les étapes importantes (25%, 50%, 75%, 100%)
    try {
      const shouldNotify = [25, 50, 75, 100].includes(totalProgress);
      if (shouldNotify) {
        const stepName = steps[stepIndex]?.name || "Étape en cours";
        await sendNotificationToUser({
          userId: booking.customer_id, // Customer reçoit la notification
          title: "Mise à jour du service",
          message: `${stepName} — Avancement: ${totalProgress}%`,
          data: {
            type: "progress_update",
            booking_id: bookingId,
            progress: totalProgress,
            step_name: stepName,
            provider_id: booking.provider_id,
          },
        });
      }
    } catch (notifError) {
      console.error("[BOOKINGS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer la mise à jour si la notification échoue
    }

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

    // ✅ ENVOYER FACTURE PEPPOL (si demandée)
    if (booking.peppol_requested && booking.peppol_status === "pending") {
      try {
        console.log(`🔵 [BOOKINGS] Sending Peppol invoice for booking ${bookingId}`);
        
        // Récupérer le provider profile complet
        const { data: providerProfile, error: providerError } = await supabase
          .from("provider_profiles")
          .select("*")
          .eq("user_id", booking.provider_id)
          .or(`id.eq.${booking.provider_id}`)
          .maybeSingle();

        if (providerError) {
          console.error("❌ [BOOKINGS] Error fetching provider for Peppol:", providerError);
        } else if (providerProfile) {
          const peppolResult = await sendPeppolInvoice(booking, providerProfile);
          
          if (peppolResult.success) {
            // Mettre à jour le statut Peppol
            await updateBookingService(bookingId, {
              peppol_status: "sent",
              peppol_invoice_id: peppolResult.invoiceId || null,
              peppol_sent_at: new Date().toISOString(),
            });
            console.log(`✅ [BOOKINGS] Peppol invoice sent successfully: ${peppolResult.invoiceId}`);
          } else {
            // Marquer comme failed mais ne pas bloquer la complétion
            await updateBookingService(bookingId, {
              peppol_status: "failed",
            });
            console.error(`❌ [BOOKINGS] Peppol invoice failed: ${peppolResult.error}`);
          }
        }
      } catch (peppolError) {
        console.error("❌ [BOOKINGS] Peppol invoice error (non-blocking):", peppolError);
        // ⚠️ Ne pas bloquer la complétion si Peppol échoue
        await updateBookingService(bookingId, {
          peppol_status: "failed",
        });
      }
    }

    // ✅ ENVOYER NOTIFICATION AU CUSTOMER (service terminé)
    try {
      await sendNotificationToUser({
        userId: booking.customer_id, // Customer reçoit la notification
        title: "Service terminé",
        message: `${booking.provider_name || "Le prestataire"} a terminé le service ${booking.service_name || ""}`,
        data: {
          type: "service_completed",
          booking_id: bookingId,
          provider_id: booking.provider_id,
        },
      });
    } catch (notifError) {
      console.error("[BOOKINGS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer la complétion si la notification échoue
    }

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

    // ✅ NOUVEAU SYSTÈME: Calcul du remboursement selon politique NIOS
    if (booking.payment_intent_id && booking.payment_status === "paid") {
      const bookingDateTime = buildBookingDateTime(
        booking.date,
        booking.start_time
      );
      const hoursUntilBooking = bookingDateTime
        ? (bookingDateTime.getTime() - Date.now()) / 1000 / 3600
        : null;

      if (hoursUntilBooking != null) {
        const { refundAmount, retainedAmount, retainedItems } = 
          calculateRefundAmount(booking, hoursUntilBooking);

        // Effectuer le remboursement partiel (si montant < total)
        if (refundAmount > 0 && refundAmount < booking.price) {
          await refundPayment(booking.payment_intent_id, refundAmount);
        } else if (refundAmount >= booking.price) {
          // Remboursement intégral
          await refundPayment(booking.payment_intent_id);
        }
        // Si refundAmount = 0, pas de remboursement (ne devrait pas arriver selon les règles)

        console.log(`💰 [CANCEL] Booking ${bookingId}: Refund ${refundAmount.toFixed(2)}€, Retained: ${retainedAmount.toFixed(2)}€ (NIOS: ${retainedItems.niosFee.toFixed(2)}€, Transport: ${retainedItems.transportFee.toFixed(2)}€)`);
      } else {
        // Si on ne peut pas calculer les heures, remboursement intégral par sécurité
        await refundPayment(booking.payment_intent_id);
      }
    }

    const ok = await updateBookingStatus(bookingId, "cancelled");
    
    // ✅ ENVOYER NOTIFICATION À L'AUTRE PARTIE (réservation annulée)
    try {
      if (isCustomer) {
        // Customer annule → Notifier le provider
        await sendNotificationToUser({
          userId: booking.provider_id,
          title: "Réservation annulée",
          message: "Un client a annulé sa réservation",
          data: {
            type: "booking_cancelled",
            booking_id: bookingId,
            cancelled_by: "customer",
            customer_id: booking.customer_id,
          },
        });
      } else if (isProvider) {
        // Provider annule → Notifier le customer
        await sendNotificationToUser({
          userId: booking.customer_id,
          title: "Réservation annulée",
          message: `${booking.provider_name || "Le prestataire"} a annulé votre réservation`,
          data: {
            type: "booking_cancelled",
            booking_id: bookingId,
            cancelled_by: "provider",
            provider_id: booking.provider_id,
          },
        });
      }
    } catch (notifError) {
      console.error("[BOOKINGS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer l'annulation si la notification échoue
    }

    return res.json({ success: ok });
  } catch (err) {
    console.error("[BOOKINGS] cancel error:", err);
    return res.status(500).json({ error: "Could not cancel booking" });
  }
}

/* -----------------------------------------------------
   COUNTER PROPOSAL (provider)
----------------------------------------------------- */
export async function counterPropose(req, res) {
  try {
    const { id } = req.params;
    const { date, start_time, end_time, message } = req.body;
    const userId = req.user.id;

    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can counter propose" });
    }

    const booking = await getBookingDetail(id);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const providerProfile = await getProviderProfileIdsForUser(userId);
    if (!providerProfile || !isBookingOwnedByProvider(booking, providerProfile)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { data, error } = await supabase
      .from("bookings")
      .update({
        counter_proposal_date: date,
        counter_proposal_start_time: start_time,
        counter_proposal_end_time: end_time,
        counter_proposal_message: message,
        counter_proposal_status: "pending",
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return res.json({ data });
  } catch (err) {
    console.error("[BOOKINGS] counterPropose error:", err);
    return res.status(500).json({ error: "Could not create counter proposal" });
  }
}

/* -----------------------------------------------------
   ACCEPT COUNTER PROPOSAL (customer)
----------------------------------------------------- */
export async function acceptCounterProposal(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const booking = await getBookingDetail(id);
    if (!booking || booking.counter_proposal_status !== "pending") {
      return res.status(400).json({ error: "No pending counter proposal" });
    }

    if (booking.customer_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { data, error } = await supabase
      .from("bookings")
      .update({
        date: booking.counter_proposal_date,
        start_time: booking.counter_proposal_start_time,
        end_time: booking.counter_proposal_end_time,
        counter_proposal_status: "accepted",
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return res.json({ data });
  } catch (err) {
    console.error("[BOOKINGS] acceptCounterProposal error:", err);
    return res.status(500).json({ error: "Could not accept counter proposal" });
  }
}

/* -----------------------------------------------------
   REFUSE COUNTER PROPOSAL (customer)
----------------------------------------------------- */
export async function refuseCounterProposal(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const booking = await getBookingDetail(id);
    if (!booking || booking.counter_proposal_status !== "pending") {
      return res.status(400).json({ error: "No pending counter proposal" });
    }

    if (booking.customer_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { data, error } = await supabase
      .from("bookings")
      .update({
        counter_proposal_status: "refused",
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return res.json({ data });
  } catch (err) {
    console.error("[BOOKINGS] refuseCounterProposal error:", err);
    return res.status(500).json({ error: "Could not refuse counter proposal" });
  }
}


/* -----------------------------------------------------
   REQUEST MODIFICATION (customer)
----------------------------------------------------- */
export async function requestModification(req, res) {
  try {
    const { id } = req.params;
    const { date, start_time, end_time, message } = req.body;
    const userId = req.user.id;

    if (req.user.role !== "customer") {
      return res.status(403).json({ error: "Only customers can request modifications" });
    }

    const booking = await getBookingDetail(id);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Vérifier que c'est le customer qui fait la demande
    if (booking.customer_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Vérifier que le booking peut être modifié (status confirmed/started)
    if (!["confirmed", "started"].includes(booking.status)) {
      return res.status(400).json({ 
        error: "Cannot request modification for this booking status" 
      });
    }

    const { data, error } = await supabase
      .from("bookings")
      .update({
        modification_request_date: date,
        modification_request_start_time: start_time,
        modification_request_end_time: end_time || start_time, // Si pas de end_time, utiliser start_time
        modification_request_message: message || null,
        modification_request_status: "pending",
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    // ✅ ENVOYER NOTIFICATION AU PROVIDER
    try {
      await sendNotificationToUser({
        userId: booking.provider_id,
        title: "Demande de modification",
        message: `Le client demande un changement de date/heure pour la réservation ${booking.service_name || ""}`,
        data: {
          type: "modification_requested",
          booking_id: id,
          customer_id: booking.customer_id,
        },
      });
    } catch (notifError) {
      console.error("[BOOKINGS] Notification send failed:", notifError);
    }

    return res.json({ data });
  } catch (err) {
    console.error("[BOOKINGS] requestModification error:", err);
    return res.status(500).json({ error: "Could not request modification" });
  }
}

/* -----------------------------------------------------
   ACCEPT MODIFICATION REQUEST (provider)
----------------------------------------------------- */
export async function acceptModificationRequest(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can accept modification requests" });
    }

    const booking = await getBookingDetail(id);
    if (!booking || booking.modification_request_status !== "pending") {
      return res.status(400).json({ error: "No pending modification request" });
    }

    const providerProfileId = await getProviderProfileIdForUser(userId);
    if (!providerProfileId || booking.provider_id !== providerProfileId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Appliquer la modification
    const { data, error } = await supabase
      .from("bookings")
      .update({
        date: booking.modification_request_date,
        start_time: booking.modification_request_start_time,
        end_time: booking.modification_request_end_time,
        modification_request_status: "accepted",
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    // ✅ ENVOYER NOTIFICATION AU CUSTOMER
    try {
      await sendNotificationToUser({
        userId: booking.customer_id,
        title: "Modification acceptée",
        message: `Votre demande de modification a été acceptée. Nouvelle date: ${booking.modification_request_date}`,
        data: {
          type: "modification_accepted",
          booking_id: id,
        },
      });
    } catch (notifError) {
      console.error("[BOOKINGS] Notification send failed:", notifError);
    }

    return res.json({ data });
  } catch (err) {
    console.error("[BOOKINGS] acceptModificationRequest error:", err);
    return res.status(500).json({ error: "Could not accept modification request" });
  }
}

/* -----------------------------------------------------
   REFUSE MODIFICATION REQUEST (provider)
----------------------------------------------------- */
export async function refuseModificationRequest(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can refuse modification requests" });
    }

    const booking = await getBookingDetail(id);
    if (!booking || booking.modification_request_status !== "pending") {
      return res.status(400).json({ error: "No pending modification request" });
    }

    const providerProfileId = await getProviderProfileIdForUser(userId);
    if (!providerProfileId || booking.provider_id !== providerProfileId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Marquer comme refusé
    const { data, error } = await supabase
      .from("bookings")
      .update({
        modification_request_status: "refused",
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    // ✅ ENVOYER NOTIFICATION AU CUSTOMER
    try {
      await sendNotificationToUser({
        userId: booking.customer_id,
        title: "Modification refusée",
        message: `Votre demande de modification a été refusée. La réservation reste à la date initiale.`,
        data: {
          type: "modification_refused",
          booking_id: id,
        },
      });
    } catch (notifError) {
      console.error("[BOOKINGS] Notification send failed:", notifError);
    }

    return res.json({ data });
  } catch (err) {
    console.error("[BOOKINGS] refuseModificationRequest error:", err);
    return res.status(500).json({ error: "Could not refuse modification request" });
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

    const providerProfile = await getProviderProfileIdsForUser(userId);
    if (!providerProfile) {
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
    if (!isBookingOwnedByProvider(booking, providerProfile)) {
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

    // 🔥 Capture sur la plateforme (commission NIOS gardée). Transfert au détaileur 3h après l'heure de résa (cron).
    const ok = await capturePayment(booking.payment_intent_id);
    if (!ok) {
      return res.status(500).json({ error: "Could not capture payment" });
    }

    const chargeId = await getChargeIdFromPaymentIntent(booking.payment_intent_id);
    if (chargeId) {
      await supabase
        .from("bookings")
        .update({ stripe_charge_id: chargeId })
        .eq("id", bookingId);
    }

    // ✅ VÉRIFIER ET MARQUER L'OFFRE DE BIENVENUE COMME UTILISÉE
    // Si c'est le premier booking et que l'offre a été appliquée, marquer comme utilisé
    if (booking.is_first_booking === true && booking.welcoming_offer_applied === true) {
      await supabase
        .from("users")
        .update({ welcoming_offer_used: true })
        .eq("id", booking.customer_id);
      console.log("🎁 [BOOKINGS] Welcoming offer marked as used for customer:", booking.customer_id);
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

    // ✅ ENVOYER NOTIFICATION AU CUSTOMER (réservation confirmée)
    try {
      await sendNotificationToUser({
        userId: booking.customer_id, // Customer reçoit la notification
        title: "Rendez-vous confirmé",
        message: `${booking.provider_name || "Le prestataire"} a confirmé votre réservation`,
        data: {
          type: "booking_confirmed",
          booking_id: bookingId,
          provider_id: booking.provider_id,
        },
      });
    } catch (notifError) {
      console.error("[BOOKINGS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer la confirmation si la notification échoue
    }

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

    const providerProfile = await getProviderProfileIdsForUser(userId);
    if (!providerProfile) {
      return res.status(403).json({
        error: "Provider profile not found",
      });
    }

    const booking = await getBookingDetail(bookingId);

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (!isBookingOwnedByProvider(booking, providerProfile)) {
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

    // ✅ ENVOYER NOTIFICATION AU CUSTOMER (réservation refusée)
    try {
      await sendNotificationToUser({
        userId: booking.customer_id, // Customer reçoit la notification
        title: "Rendez-vous refusé",
        message: `${booking.provider_name || "Le prestataire"} a refusé votre demande de réservation`,
        data: {
          type: "booking_declined",
          booking_id: bookingId,
          provider_id: booking.provider_id,
        },
      });
    } catch (notifError) {
      console.error("[BOOKINGS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer le refus si la notification échoue
    }

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

    // ✅ ENVOYER NOTIFICATION AU CUSTOMER (remboursement effectué)
    try {
      const refundAmount = booking.price || 0;
      await sendNotificationToUser({
        userId: booking.customer_id, // Customer reçoit la notification
        title: "Remboursement effectué",
        message: `Votre remboursement de ${refundAmount.toFixed(2)}€ a été effectué`,
        data: {
          type: "refund_processed",
          booking_id: bookingId,
          amount: refundAmount,
          provider_id: booking.provider_id,
        },
      });
    } catch (notifError) {
      console.error("[BOOKINGS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer le remboursement si la notification échoue
    }

    return res.json({ success: true, data: updated });

  } catch (err) {
    console.error("[BOOKINGS] refund error:", err);
    return res.status(500).json({ error: "Could not refund booking" });
  }
}

export async function cleanupExpiredBookingsController(req, res) {
  try {
    const deletedCount = await cleanupExpiredBookings();
    return res.json({
      success: true,
      deleted_count: deletedCount,
      message: `Deleted ${deletedCount} expired bookings`,
    });
  } catch (err) {
    console.error("[BOOKINGS] cleanup error:", err);
    return res.status(500).json({ error: "Could not cleanup expired bookings" });
  }
}
