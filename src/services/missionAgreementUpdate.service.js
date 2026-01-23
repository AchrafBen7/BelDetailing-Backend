// src/services/missionAgreementUpdate.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { mapMissionAgreementRowToDto } from "./missionAgreement.service.js";

/**
 * 🟦 UPDATE AGREEMENT – Mettre à jour un Mission Agreement (company édition)
 * Permet de modifier : dates, prix, acompte, payment schedule, etc.
 * 
 * @param {string} id - ID du Mission Agreement
 * @param {Object} updates - Champs à mettre à jour
 * @param {string} userId - ID de l'utilisateur (doit être la company)
 * @returns {Promise<Object>} Mission Agreement mis à jour
 */
export async function updateMissionAgreement(id, updates, userId) {
  // 1) Vérifier que l'agreement existe et appartient à cette company
  const { data: existing, error: fetchError } = await supabase
    .from("mission_agreements")
    .select("id, company_id, status, final_price")
    .eq("id", id)
    .single();

  if (fetchError) throw fetchError;
  if (!existing) {
    const err = new Error("Mission Agreement not found");
    err.statusCode = 404;
    throw err;
  }

  if (existing.company_id !== userId) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  // 2) Vérifier que le statut permet l'édition (seulement draft)
  if (existing.status !== "draft") {
    const err = new Error("Mission Agreement can only be edited when status is 'draft'");
    err.statusCode = 400;
    throw err;
  }

  // 3) Construire le payload de mise à jour
  const updatePayload = {
    updated_at: new Date().toISOString(),
  };

  // Dates
  if (updates.startDate !== undefined) {
    updatePayload.start_date = updates.startDate || null;
  }
  if (updates.endDate !== undefined) {
    updatePayload.end_date = updates.endDate || null;
  }
  if (updates.estimatedDurationDays !== undefined) {
    updatePayload.estimated_duration_days = updates.estimatedDurationDays || null;
  }

  // Prix
  if (updates.finalPrice !== undefined) {
    updatePayload.final_price = updates.finalPrice;
  }
  if (updates.depositPercentage !== undefined) {
    updatePayload.deposit_percentage = updates.depositPercentage;
    // Recalculer deposit_amount et remaining_amount
    const price = updates.finalPrice ?? existing.final_price;
    if (price) {
      const depositAmount = Math.round((price * updates.depositPercentage) / 100 * 100) / 100;
      const remainingAmount = Math.round((price - depositAmount) * 100) / 100;
      updatePayload.deposit_amount = depositAmount;
      updatePayload.remaining_amount = remainingAmount;
    }
  }

  // Payment schedule
  if (updates.paymentSchedule !== undefined) {
    updatePayload.payment_schedule = updates.paymentSchedule;
  }

  // Informations générales
  if (updates.title !== undefined) {
    updatePayload.title = updates.title;
  }
  if (updates.description !== undefined) {
    updatePayload.description = updates.description;
  }
  if (updates.locationCity !== undefined) {
    updatePayload.location_city = updates.locationCity;
  }
  if (updates.locationPostalCode !== undefined) {
    updatePayload.location_postal_code = updates.locationPostalCode;
  }
  if (updates.vehicleCount !== undefined) {
    updatePayload.vehicle_count = updates.vehicleCount;
  }

  // 4) Mettre à jour
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
 * 🟦 CONFIRM AGREEMENT (COMPANY) – Confirmer le Mission Agreement côté company
 * Change le statut de "draft" → "waiting_for_detailer_confirmation"
 * 
 * @param {string} id - ID du Mission Agreement
 * @param {string} userId - ID de la company
 * @returns {Promise<Object>} Mission Agreement confirmé
 */
export async function confirmMissionAgreementByCompany(id, userId) {
  // 1) Vérifier que l'agreement existe et appartient à cette company
  const { data: existing, error: fetchError } = await supabase
    .from("mission_agreements")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError) throw fetchError;
  if (!existing) {
    const err = new Error("Mission Agreement not found");
    err.statusCode = 404;
    throw err;
  }

  if (existing.company_id !== userId) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  // 2) Vérifier que le statut est "draft"
  if (existing.status !== "draft") {
    const err = new Error(`Mission Agreement cannot be confirmed. Current status: ${existing.status}`);
    err.statusCode = 400;
    throw err;
  }

  // 3) VALIDATION COMPLÈTE : Toutes les règles doivent être respectées avant confirmation
  const validationErrors = [];

  // 3.1) Dates obligatoires
  if (!existing.start_date || !existing.end_date) {
    validationErrors.push("Les dates de début et de fin sont requises");
  } else {
    // Vérifier que la date de fin est après la date de début
    const startDate = new Date(existing.start_date);
    const endDate = new Date(existing.end_date);
    if (endDate <= startDate) {
      validationErrors.push("La date de fin doit être postérieure à la date de début");
    }
  }

  // 3.2) Prix total obligatoire
  if (!existing.final_price || existing.final_price <= 0) {
    validationErrors.push("Le prix total doit être supérieur à 0");
  }

  // 3.3) Acompte obligatoire et valide
  if (existing.deposit_percentage === null || existing.deposit_percentage === undefined) {
    validationErrors.push("Le pourcentage d'acompte est requis");
  } else if (existing.deposit_percentage < 0 || existing.deposit_percentage > 100) {
    validationErrors.push("Le pourcentage d'acompte doit être entre 0 et 100");
  }

  // 3.4) Vérifier que deposit_amount et remaining_amount sont calculés
  if (!existing.deposit_amount || existing.deposit_amount < 0) {
    validationErrors.push("Le montant de l'acompte doit être calculé et supérieur ou égal à 0");
  }
  if (!existing.remaining_amount || existing.remaining_amount < 0) {
    validationErrors.push("Le montant restant doit être calculé et supérieur ou égal à 0");
  }

  // 3.5) Payment schedule obligatoire
  if (!existing.payment_schedule || typeof existing.payment_schedule !== 'object') {
    validationErrors.push("Le plan de paiement est requis");
  }

  // 3.6) Informations générales obligatoires
  if (!existing.title || existing.title.trim() === "") {
    validationErrors.push("Le titre de la mission est requis");
  }
  if (!existing.description || existing.description.trim() === "") {
    validationErrors.push("La description de la mission est requise");
  }
  if (!existing.location_city || existing.location_city.trim() === "") {
    validationErrors.push("La ville de la mission est requise");
  }
  if (!existing.location_postal_code || existing.location_postal_code.trim() === "") {
    validationErrors.push("Le code postal de la mission est requis");
  }
  if (!existing.vehicle_count || existing.vehicle_count <= 0) {
    validationErrors.push("Le nombre de véhicules doit être supérieur à 0");
  }

  // 3.7) Vérifier que le detailer a un Stripe Connect account (pour les payouts)
  const { data: providerProfile, error: providerError } = await supabase
    .from("provider_profiles")
    .select("stripe_account_id")
    .eq("user_id", existing.detailer_id)
    .maybeSingle();

  if (providerError) {
    console.warn("[MISSION AGREEMENT] Error checking provider Stripe account:", providerError);
  } else if (!providerProfile?.stripe_account_id) {
    validationErrors.push("Le detailer doit avoir un compte Stripe Connect configuré pour recevoir les paiements");
  }

  // 3.8) Si des erreurs de validation, les retourner toutes
  if (validationErrors.length > 0) {
    const err = new Error(`Validation failed: ${validationErrors.join("; ")}`);
    err.statusCode = 400;
    err.validationErrors = validationErrors;
    throw err;
  }

  // 4) Générer le PDF du contrat
  let pdfUrl = existing.agreement_pdf_url;
  if (!pdfUrl) {
    try {
      const { generateAndSaveMissionAgreementPdf } = await import("./missionAgreementPdf.service.js");
      const generatedPdf = await generateAndSaveMissionAgreementPdf(id);
      pdfUrl = generatedPdf;
    } catch (pdfError) {
      console.error("[MISSION AGREEMENT] Failed to generate PDF on confirmation:", pdfError);
      // Ne pas bloquer la confirmation si le PDF échoue
    }
  }

  // 5) Mettre à jour le statut
  const { data, error } = await supabase
    .from("mission_agreements")
    .update({
      status: "waiting_for_detailer_confirmation",
      agreement_pdf_url: pdfUrl || existing.agreement_pdf_url,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  const updatedAgreement = mapMissionAgreementRowToDto(data);

  // 6) Envoyer notification au detailer
  try {
    const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
    await sendNotificationWithDeepLink({
      userId: updatedAgreement.detailerId,
      title: "Nouveau contrat de mission",
      message: `Un nouveau contrat de mission "${updatedAgreement.title || 'votre mission'}" vous attend`,
      type: "mission_agreement_pending",
      id: id,
    });
  } catch (notifError) {
    console.error("[MISSION AGREEMENT] Notification send failed:", notifError);
    // Ne pas faire échouer la confirmation si la notification échoue
  }

  return updatedAgreement;
}

/**
 * 🟦 ACCEPT AGREEMENT (DETAILER) – Accepter le Mission Agreement côté detailer
 * Change le statut de "waiting_for_detailer_confirmation" → "agreement_fully_confirmed"
 * 
 * @param {string} id - ID du Mission Agreement
 * @param {string} userId - ID du detailer
 * @returns {Promise<Object>} Mission Agreement accepté
 */
export async function acceptMissionAgreementByDetailer(id, userId) {
  // 1) Vérifier que l'agreement existe et appartient à ce detailer
  const { data: existing, error: fetchError } = await supabase
    .from("mission_agreements")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError) throw fetchError;
  if (!existing) {
    const err = new Error("Mission Agreement not found");
    err.statusCode = 404;
    throw err;
  }

  if (existing.detailer_id !== userId) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  // 2) Vérifier que le statut est "waiting_for_detailer_confirmation"
  if (existing.status !== "waiting_for_detailer_confirmation") {
    const err = new Error(`Mission Agreement cannot be accepted. Current status: ${existing.status}`);
    err.statusCode = 400;
    throw err;
  }

  // 3) Mettre à jour le statut
  const { data, error } = await supabase
    .from("mission_agreements")
    .update({
      status: "agreement_fully_confirmed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  const updatedAgreement = mapMissionAgreementRowToDto(data);

  // 4) Envoyer notification à la company
  try {
    const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
    await sendNotificationWithDeepLink({
      userId: updatedAgreement.companyId,
      title: "Contrat accepté",
      message: `Le detailer a accepté le contrat "${updatedAgreement.title || 'votre mission'}"`,
      type: "mission_agreement_accepted",
      id: id,
    });
  } catch (notifError) {
    console.error("[MISSION AGREEMENT] Notification send failed:", notifError);
    // Ne pas faire échouer l'acceptation si la notification échoue
  }

  // 5) ⚠️ IMPORTANT : Ne PAS créer les paiements ici
  // Les paiements seront créés seulement quand la company paiera (étape suivante)
  // Cela permet de vérifier le moyen de paiement avant de créer les paiements programmés

  return updatedAgreement;
}
