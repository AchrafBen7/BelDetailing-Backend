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

  // 3) Validation : dates, prix, acompte doivent être définis
  if (!existing.start_date || !existing.end_date) {
    const err = new Error("Start date and end date are required to confirm the agreement");
    err.statusCode = 400;
    throw err;
  }

  if (!existing.final_price || existing.final_price <= 0) {
    const err = new Error("Final price must be greater than 0");
    err.statusCode = 400;
    throw err;
  }

  if (!existing.deposit_percentage || existing.deposit_percentage < 0 || existing.deposit_percentage > 100) {
    const err = new Error("Deposit percentage must be between 0 and 100");
    err.statusCode = 400;
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
