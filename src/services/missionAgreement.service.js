// src/services/missionAgreement.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * DB → DTO (iOS Mission Agreement)
 */
function mapMissionAgreementRowToDto(row) {
  if (!row) return null;

  return {
    id: row.id,
    offerId: row.offer_id,
    applicationId: row.application_id,
    companyId: row.company_id,
    detailerId: row.detailer_id,
    title: row.title,
    description: row.description,
    locationCity: row.location_city,
    locationPostalCode: row.location_postal_code,
    vehicleCount: row.vehicle_count,
    finalPrice: row.final_price ? Number(row.final_price) : null,
    depositPercentage: row.deposit_percentage,
    depositAmount: row.deposit_amount ? Number(row.deposit_amount) : null,
    remainingAmount: row.remaining_amount ? Number(row.remaining_amount) : null,
    paymentSchedule: row.payment_schedule, // JSON object
    startDate: row.start_date,
    endDate: row.end_date,
    estimatedDurationDays: row.estimated_duration_days,
    status: row.status,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeConnectedAccountId: row.stripe_connected_account_id,
    agreementPdfUrl: row.agreement_pdf_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 🟦 CREATE – Créer un Mission Agreement après acceptation d'une candidature
 * 
 * @param {Object} params
 * @param {string} params.applicationId - ID de l'application acceptée
 * @param {string} params.offerId - ID de l'offre
 * @param {string} params.companyId - ID de la company
 * @param {string} params.detailerId - ID du detailer
 * @param {number} params.finalPrice - Prix final accepté
 * @param {number} params.depositPercentage - Pourcentage d'acompte (20, 30, etc.)
 * @param {Object} params.paymentSchedule - Plan de paiement JSON
 * @param {Object} params.offerData - Données de l'offre (title, description, etc.)
 * @returns {Promise<Object>} Mission Agreement créé
 */
export async function createMissionAgreement({
  applicationId,
  offerId,
  companyId,
  detailerId,
  finalPrice,
  depositPercentage,
  paymentSchedule,
  offerData,
}) {
  // Calculer les montants
  const depositAmount = Math.round((finalPrice * depositPercentage) / 100 * 100) / 100;
  const remainingAmount = Math.round((finalPrice - depositAmount) * 100) / 100;

  // Récupérer le Stripe Connected Account ID du detailer
  const { data: providerProfile, error: providerError } = await supabase
    .from("provider_profiles")
    .select("stripe_account_id")
    .eq("user_id", detailerId)
    .maybeSingle();

  if (providerError) {
    console.warn("[MISSION AGREEMENT] Error fetching provider profile:", providerError);
  }

  // Récupérer le Stripe Customer ID de la company (sera créé plus tard si nécessaire)
  const { data: companyUser, error: companyError } = await supabase
    .from("users")
    .select("stripe_customer_id")
    .eq("id", companyId)
    .single();

  if (companyError) {
    console.warn("[MISSION AGREEMENT] Error fetching company user:", companyError);
  }

  const insertPayload = {
    offer_id: offerId,
    application_id: applicationId,
    company_id: companyId,
    detailer_id: detailerId,
    title: offerData.title,
    description: offerData.description,
    location_city: offerData.city,
    location_postal_code: offerData.postalCode,
    vehicle_count: offerData.vehicleCount,
    final_price: finalPrice,
    deposit_percentage: depositPercentage,
    deposit_amount: depositAmount,
    remaining_amount: remainingAmount,
    payment_schedule: paymentSchedule || { type: "one_shot" },
    start_date: null, // Sera défini plus tard
    end_date: null,
    estimated_duration_days: null,
    status: "draft", // Sera activé après setup SEPA
    stripe_customer_id: companyUser?.stripe_customer_id || null,
    stripe_connected_account_id: providerProfile?.stripe_account_id || null,
    agreement_pdf_url: null, // Sera généré plus tard
  };

  const { data, error } = await supabase
    .from("mission_agreements")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    console.error("[MISSION AGREEMENT] Insert error:", error);
    throw error;
  }

  console.log("✅ [MISSION AGREEMENT] Created:", data.id);
  return mapMissionAgreementRowToDto(data);
}

/**
 * 🟦 GET BY ID – Récupérer un Mission Agreement par ID
 */
export async function getMissionAgreementById(id) {
  const { data, error } = await supabase
    .from("mission_agreements")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    throw error;
  }

  return mapMissionAgreementRowToDto(data);
}

/**
 * 🟦 GET FOR USER – Récupérer les Mission Agreements d'un utilisateur (company ou detailer)
 * 
 * @param {string} userId - ID de l'utilisateur
 * @param {string} role - "company" ou "provider"
 * @param {string} status - Filtrer par statut (optionnel)
 */
export async function getMissionAgreementsForUser(userId, role, status = null) {
  let query = supabase.from("mission_agreements").select("*");

  if (role === "company") {
    query = query.eq("company_id", userId);
  } else if (role === "provider") {
    query = query.eq("detailer_id", userId);
  } else {
    throw new Error("Invalid role. Must be 'company' or 'provider'");
  }

  if (status) {
    query = query.eq("status", status);
  }

  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;

  if (error) throw error;

  return data.map(mapMissionAgreementRowToDto);
}

/**
 * 🟦 UPDATE STATUS – Mettre à jour le statut d'un Mission Agreement
 */
export async function updateMissionAgreementStatus(id, newStatus) {
  const validStatuses = ["draft", "active", "completed", "cancelled", "suspended"];
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
  }

  const { data, error } = await supabase
    .from("mission_agreements")
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return mapMissionAgreementRowToDto(data);
}

/**
 * 🟦 UPDATE STRIPE INFO – Mettre à jour les IDs Stripe
 */
export async function updateMissionAgreementStripeInfo(id, stripeInfo) {
  const updatePayload = {};

  if (stripeInfo.paymentIntentId) {
    updatePayload.stripe_payment_intent_id = stripeInfo.paymentIntentId;
  }
  if (stripeInfo.subscriptionId) {
    updatePayload.stripe_subscription_id = stripeInfo.subscriptionId;
  }
  if (stripeInfo.customerId) {
    updatePayload.stripe_customer_id = stripeInfo.customerId;
  }
  if (stripeInfo.connectedAccountId) {
    updatePayload.stripe_connected_account_id = stripeInfo.connectedAccountId;
  }

  if (Object.keys(updatePayload).length === 0) {
    return getMissionAgreementById(id);
  }

  const { data, error } = await supabase
    .from("mission_agreements")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return mapMissionAgreementRowToDto(data);
}

/**
 * 🟦 UPDATE DATES – Mettre à jour les dates de mission
 */
export async function updateMissionAgreementDates(id, dates) {
  const updatePayload = {};

  if (dates.startDate) {
    updatePayload.start_date = dates.startDate;
  }
  if (dates.endDate) {
    updatePayload.end_date = dates.endDate;
  }
  if (dates.estimatedDurationDays !== undefined) {
    updatePayload.estimated_duration_days = dates.estimatedDurationDays;
  }

  if (Object.keys(updatePayload).length === 0) {
    return getMissionAgreementById(id);
  }

  const { data, error } = await supabase
    .from("mission_agreements")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return mapMissionAgreementRowToDto(data);
}

/**
 * 🟦 UPDATE PDF URL – Mettre à jour l'URL du PDF Mission Agreement
 */
export async function updateMissionAgreementPdfUrl(id, pdfUrl) {
  const { data, error } = await supabase
    .from("mission_agreements")
    .update({
      agreement_pdf_url: pdfUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return mapMissionAgreementRowToDto(data);
}
