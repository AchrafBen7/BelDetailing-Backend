// src/services/applicationBooking.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { createPaymentIntent } from "./payment.service.js";
import { BOOKING_COMMISSION_RATE } from "../config/commission.js";

/**
 * Crée un booking réel à partir d'une application acceptée
 * Cette fonction est appelée quand une company accepte une application
 * et doit payer pour créer le booking (même logique que bookingCreate)
 * 
 * @param {Object} params
 * @param {string} params.applicationId - ID de l'application acceptée
 * @param {string} params.companyId - ID de la company (customer du booking)
 * @param {string} params.detailerId - ID du detailer (provider du booking)
 * @param {number} params.finalPrice - Prix final accepté
 * @param {string} params.offerId - ID de l'offre
 * @param {Object} params.offerData - Données de l'offre (title, description, city, postal_code, vehicle_count)
 * @returns {Promise<Object>} Booking créé avec payment intent
 */
export async function createBookingFromApplication({
  applicationId,
  companyId,
  detailerId,
  finalPrice,
  offerId,
  offerData,
}) {
  // 1) Récupérer le provider profile
  const { data: provider, error: providerError } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("user_id", detailerId)
    .maybeSingle();

  if (providerError) throw providerError;
  if (!provider) {
    const err = new Error("Provider profile not found");
    err.statusCode = 404;
    throw err;
  }

  // 2) Récupérer la company profile pour l'adresse
  const { data: companyProfile, error: companyError } = await supabase
    .from("company_profiles")
    .select("*")
    .eq("user_id", companyId)
    .maybeSingle();

  if (companyError) {
    console.warn("[APPLICATION BOOKING] Company profile error:", companyError);
  }

  // 3) Créer le booking (sans payment intent pour l'instant)
  // ⚠️ IMPORTANT : Pour les missions, la date n'est pas connue au moment de l'acceptation
  // Elle sera définie plus tard dans le Mission Agreement
  // La colonne date est maintenant nullable (migration: make_booking_date_nullable.sql)
  const bookingData = {
    provider_id: detailerId,
    customer_id: companyId, // La company est le "customer" du booking
    service_id: null, // Pas de service spécifique pour les missions
    provider_name: provider.display_name || provider.company_name || "Provider",
    service_name: offerData.title || "Mission",
    price: finalPrice,
    currency: "eur",
    date: null, // NULL pour les missions - la date sera définie dans le Mission Agreement
    start_time: null,
    end_time: null,
    address: companyProfile?.city 
      ? `${companyProfile.city}, ${companyProfile.postal_code || ""}`.trim()
      : offerData.city || "",
    status: "pending",
    payment_status: "pending",
    payment_intent_id: null,
    commission_rate: BOOKING_COMMISSION_RATE,
    invoice_sent: false,
    provider_banner_url: provider.banner_url || provider.logo_url || null,
    transport_fee: 0, // Pas de transport pour les missions (service sur site company)
    transport_distance_km: null,
  };

  // Ajouter application_id et offer_id seulement si fournis (colonnes optionnelles)
  if (applicationId) {
    bookingData.application_id = applicationId;
  }
  if (offerId) {
    bookingData.offer_id = offerId;
  }

  let booking;
  const { data: insertedBooking, error: bookingError } = await supabase
    .from("bookings")
    .insert(bookingData)
    .select("*")
    .single();

  // Si l'erreur est due à une colonne inexistante, réessayer sans ces colonnes
  if (bookingError && bookingError.code === "42703") {
    console.warn("[APPLICATION BOOKING] Column does not exist, retrying without application_id/offer_id");
    const fallbackData = { ...bookingData };
    delete fallbackData.application_id;
    delete fallbackData.offer_id;
    
    const { data: fallbackBooking, error: fallbackError } = await supabase
      .from("bookings")
      .insert(fallbackData)
      .select("*")
      .single();
    
    if (fallbackError) throw fallbackError;
    booking = fallbackBooking;
  } else if (bookingError) {
    throw bookingError;
  } else {
    booking = insertedBooking;
  }

  // 4) Récupérer le customer (company) pour créer le payment intent
  const { data: customer, error: customerError } = await supabase
    .from("users")
    .select("id, email, phone, stripe_customer_id")
    .eq("id", companyId)
    .single();

  if (customerError || !customer) {
    // Supprimer le booking créé si on ne peut pas créer le payment intent
    await supabase.from("bookings").delete().eq("id", booking.id);
    throw new Error("Customer not found");
  }

  // 5) Créer le payment intent (même logique que bookingCreate - capture_method: "manual")
  const intent = await createPaymentIntent({
    amount: finalPrice,
    currency: "eur",
    user: customer,
  });

  // 6) Mettre à jour le booking avec le payment intent
  const { data: updatedBooking, error: updateError } = await supabase
    .from("bookings")
    .update({
      payment_intent_id: intent.id,
      payment_status: "preauthorized", // Pré-autorisé, sera capturé quand le provider confirmera
    })
    .eq("id", booking.id)
    .select("*")
    .single();

  if (updateError) {
    // Supprimer le payment intent si la mise à jour échoue
    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2023-10-16",
      });
      await stripe.paymentIntents.cancel(intent.id);
    } catch (cancelError) {
      console.error("[APPLICATION BOOKING] Error canceling payment intent:", cancelError);
    }
    throw updateError;
  }

  return {
    booking: updatedBooking,
    paymentIntent: {
      id: intent.id,
      clientSecret: intent.clientSecret,
      amount: finalPrice,
      currency: "eur",
    },
  };
}
