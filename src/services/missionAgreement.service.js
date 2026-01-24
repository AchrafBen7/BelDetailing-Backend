// src/services/missionAgreement.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { logger } from "../observability/logger.js";
import { missionAgreementsTotal } from "../observability/metrics.js";

/**
 * DB → DTO (iOS Mission Agreement)
 */
export function mapMissionAgreementRowToDto(row) {
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
    operationalRules: row.operational_rules || null, // JSON object - Règles opérationnelles
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
    
    // 🆕 STRUCTURE COMPLÈTE DU CONTRAT
    // 1️⃣ Métadonnées du contrat (non modifiables)
    contractVersion: row.contract_version || 1,
    contractCreatedAt: row.contract_created_at || row.created_at,
    categories: row.categories || (row.category ? [row.category] : []), // Array de catégories
    missionType: row.mission_type || "one-time", // 'one-time', 'recurring', 'long-term'
    country: row.country || "Belgium",
    currency: row.currency || "eur",
    commissionRate: row.commission_rate ? Number(row.commission_rate) : 0.07, // 7% par défaut
    
    // 2️⃣ Parties au contrat (obligatoire)
    companyLegalName: row.company_legal_name,
    companyVatNumber: row.company_vat_number,
    companyLegalAddress: row.company_legal_address,
    companyLegalRepresentative: row.company_legal_representative,
    companyEmail: row.company_email,
    detailerLegalName: row.detailer_legal_name,
    detailerVatNumber: row.detailer_vat_number,
    detailerAddress: row.detailer_address,
    detailerIban: row.detailer_iban,
    detailerEmail: row.detailer_email,
    
    // 3️⃣ Objet de la mission
    exactAddress: row.exact_address, // Adresse exacte d'intervention (modifiable)
    specificConstraints: row.specific_constraints,
    requiredProducts: row.required_products, // JSON array
    
    // 4️⃣ Paramètres modifiables par la company
    invoiceRequired: row.invoice_required ?? true,
    paymentType: row.payment_type || "fractionated",
    
    // 5️⃣ Acceptation du contrat
    companyAcceptedAt: row.company_accepted_at,
    detailerAcceptedAt: row.detailer_accepted_at,
    contractVersionAtAcceptance: row.contract_version_at_acceptance,
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
  // ✅ VALIDATION : finalPrice doit être > 0
  if (!finalPrice || finalPrice <= 0) {
    throw new Error("finalPrice must be greater than 0");
  }

  // ✅ VALIDATION : depositPercentage doit être entre 0 et 100
  if (depositPercentage < 0 || depositPercentage > 100) {
    throw new Error("depositPercentage must be between 0 and 100");
  }

  // ✅ VALIDATION : companyId et detailerId doivent être fournis
  if (!companyId || !detailerId) {
    throw new Error("companyId and detailerId are required");
  }

  // Calculer les montants
  const depositAmount = Math.round((finalPrice * depositPercentage) / 100 * 100) / 100;
  const remainingAmount = Math.round((finalPrice - depositAmount) * 100) / 100;

  // 🆕 RÉCUPÉRER LES INFOS LÉGALES DE LA COMPANY
  const { data: companyUser, error: companyUserError } = await supabase
    .from("users")
    .select("email, vat_number, stripe_customer_id")
    .eq("id", companyId)
    .single();

  if (companyUserError) {
    console.warn("[MISSION AGREEMENT] Error fetching company user:", companyUserError);
  }

  const { data: companyProfile, error: companyProfileError } = await supabase
    .from("company_profiles")
    .select("legal_name, city, postal_code, contact_name")
    .eq("user_id", companyId)
    .maybeSingle();

  if (companyProfileError) {
    console.warn("[MISSION AGREEMENT] Error fetching company profile:", companyProfileError);
  }

  // Construire l'adresse légale de la company
  const companyLegalAddress = companyProfile
    ? `${companyProfile.city || ""} ${companyProfile.postal_code || ""}`.trim()
    : null;

  // 🆕 RÉCUPÉRER LES INFOS LÉGALES DU DETAILER
  const { data: detailerUser, error: detailerUserError } = await supabase
    .from("users")
    .select("email, vat_number")
    .eq("id", detailerId)
    .single();

  if (detailerUserError) {
    console.warn("[MISSION AGREEMENT] Error fetching detailer user:", detailerUserError);
  }

  const { data: providerProfile, error: providerError } = await supabase
    .from("provider_profiles")
    .select("stripe_account_id, display_name, base_city, postal_code, company_name")
    .eq("user_id", detailerId)
    .maybeSingle();

  if (providerError) {
    console.warn("[MISSION AGREEMENT] Error fetching provider profile:", providerError);
  }

  // Construire l'adresse du detailer
  const detailerAddress = providerProfile
    ? `${providerProfile.base_city || ""} ${providerProfile.postal_code || ""}`.trim()
    : null;

  // Récupérer le nom légal du detailer (company_name ou display_name)
  const detailerLegalName = providerProfile?.company_name || providerProfile?.display_name || null;

  // 🆕 RÉCUPÉRER L'IBAN DU DETAILER (depuis Stripe Connect account si disponible)
  let detailerIban = null;
  if (providerProfile?.stripe_account_id) {
    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2025-11-17.clover",
      });
      
      const account = await stripe.accounts.retrieve(providerProfile.stripe_account_id);
      // Stripe stocke l'IBAN dans external_accounts
      if (account.external_accounts?.data?.length > 0) {
        const bankAccount = account.external_accounts.data.find(acc => acc.object === "bank_account");
        if (bankAccount) {
          detailerIban = bankAccount.last4 ? `****${bankAccount.last4}` : null; // Masquer pour sécurité
        }
      }
    } catch (stripeError) {
      console.warn("[MISSION AGREEMENT] Error fetching detailer IBAN from Stripe:", stripeError);
      // Ne pas faire échouer la création si l'IBAN n'est pas disponible
    }
  }

  // 🆕 RÉCUPÉRER LES CATÉGORIES ET LE TYPE DE MISSION DEPUIS L'OFFRE
  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .select("categories, type")
    .eq("id", offerId)
    .maybeSingle();

  if (offerError) {
    console.warn("[MISSION AGREEMENT] Error fetching offer:", offerError);
  }

  const categories = offer?.categories || (offer?.category ? [offer.category] : []);
  const missionType = offer?.type || "one-time"; // 'oneTime' → 'one-time' pour le contrat

  // 🆕 STRUCTURE COMPLÈTE DU CONTRAT
  const insertPayload = {
    // Champs existants
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
    payment_schedule: paymentSchedule || { type: "fractionated" }, // Par défaut fractionné
    operational_rules: null, // Sera défini lors de l'édition par la company
    start_date: null, // Sera défini plus tard
    end_date: null,
    estimated_duration_days: null,
    status: "draft", // Sera activé après setup SEPA
    stripe_customer_id: companyUser?.stripe_customer_id || null,
    stripe_connected_account_id: providerProfile?.stripe_account_id || null,
    agreement_pdf_url: null, // Sera généré plus tard
    
    // 🆕 1️⃣ MÉTADONNÉES DU CONTRAT (NON MODIFIABLES)
    contract_version: 1, // Version initiale
    contract_created_at: new Date().toISOString(),
    categories: categories, // Array de catégories depuis l'offre
    mission_type: missionType === "oneTime" ? "one-time" : (missionType === "longTerm" ? "long-term" : missionType), // Normaliser
    country: "Belgium", // Juridiction
    currency: "eur", // Devise
    commission_rate: 0.07, // 7% commission NIOS
    
    // 🆕 2️⃣ PARTIES AU CONTRAT (OBLIGATOIRE) - Company
    company_legal_name: companyProfile?.legal_name || null,
    company_vat_number: companyUser?.vat_number || null,
    company_legal_address: companyLegalAddress,
    company_legal_representative: companyProfile?.contact_name || null,
    company_email: companyUser?.email || null,
    
    // 🆕 2️⃣ PARTIES AU CONTRAT (OBLIGATOIRE) - Detailer
    detailer_legal_name: detailerLegalName,
    detailer_vat_number: detailerUser?.vat_number || null,
    detailer_address: detailerAddress,
    detailer_iban: detailerIban, // IBAN masqué depuis Stripe
    detailer_email: detailerUser?.email || null,
    
    // 🆕 3️⃣ OBJET DE LA MISSION
    exact_address: null, // Sera défini par la company lors de l'édition
    specific_constraints: null, // Sera défini par la company
    required_products: null, // Sera défini par la company (JSON array)
    
    // 🆕 4️⃣ PARAMÈTRES MODIFIABLES PAR LA COMPANY
    invoice_required: true, // Par défaut, facturation requise
    payment_type: "fractionated", // Paiement fractionné obligatoire
    
    // 🆕 5️⃣ ACCEPTATION DU CONTRAT (sera rempli plus tard)
    company_accepted_at: null,
    detailer_accepted_at: null,
    contract_version_at_acceptance: null,
  };

  const { data, error } = await supabase
    .from("mission_agreements")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    logger.error({ error, missionAgreementId: data?.id, finalPrice, depositPercentage }, "[MISSION AGREEMENT] Insert error");
    throw error;
  }

  logger.info({ missionAgreementId: data.id, companyId, detailerId, finalPrice, status: data.status }, "[MISSION AGREEMENT] Created");
  
  // ✅ MÉTRIQUE : Incrémenter le compteur de mission agreements
  missionAgreementsTotal.inc({ status: data.status });

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
    // Les companies voient tous leurs Mission Agreements (y compris draft)
  } else if (role === "provider") {
    query = query.eq("detailer_id", userId);
    // 🔒 SÉCURITÉ : Les detailers ne voient QUE les Mission Agreements confirmés par la company
    // (statut >= waiting_for_detailer_confirmation)
    // Les Mission Agreements en "draft" ne sont pas visibles pour les detailers
    query = query.neq("status", "draft");
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
  const validStatuses = [
    "draft", 
    "waiting_for_detailer_confirmation", 
    "agreement_fully_confirmed",
    "active", 
    "completed", 
    "cancelled", 
    "suspended"
  ];
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

  const updatedAgreement = mapMissionAgreementRowToDto(data);

  // ✅ ENVOYER NOTIFICATIONS si mission terminée → company + detailer
  if (newStatus === "completed") {
    try {
      const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
      
      // Notification à la company
      if (updatedAgreement.companyId) {
        await sendNotificationWithDeepLink({
          userId: updatedAgreement.companyId,
          title: "Mission terminée",
          message: `La mission "${updatedAgreement.title || 'votre mission'}" est terminée`,
          type: "mission_completed",
          id: id,
        });
      }
      
      // Notification au detailer
      if (updatedAgreement.detailerId) {
        await sendNotificationWithDeepLink({
          userId: updatedAgreement.detailerId,
          title: "Mission terminée",
          message: `La mission "${updatedAgreement.title || 'votre mission'}" est terminée`,
          type: "mission_completed",
          id: id,
        });
      }
    } catch (notifError) {
      console.error(`❌ [MISSION AGREEMENT] Notification send failed for completed mission ${id}:`, notifError);
      // Ne pas faire échouer la mise à jour si la notification échoue
    }
  }

  return updatedAgreement;
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
