// src/services/missionAgreementUpdate.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { mapMissionAgreementRowToDto } from "./missionAgreement.service.js";

/**
 * 🟦 UPDATE AGREEMENT – Mettre à jour un Mission Agreement (company édition)
 * 
 * 🔒 CHAMPS VERROUILLÉS (non modifiables) :
 * - title, description, locationCity, locationPostalCode, vehicleCount, finalPrice, detailer_id
 * Ces champs ont été validés lors de l'acceptation de la candidature.
 * 
 * ✅ CHAMPS MODIFIABLES :
 * - dates (startDate, endDate)
 * - structure de paiement (depositPercentage, paymentSchedule)
 * - règles opérationnelles
 * 
 * @param {string} id - ID du Mission Agreement
 * @param {Object} updates - Champs à mettre à jour (seulement les champs modifiables)
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
  // 🔒 finalPrice est VERROUILLÉ (ne peut pas être modifié)
  // On utilise toujours existing.final_price pour les calculs
  if (updates.depositPercentage !== undefined) {
    updatePayload.deposit_percentage = updates.depositPercentage;
    // Recalculer deposit_amount et remaining_amount
    // ⚠️ Toujours utiliser existing.final_price (verrouillé)
    const price = existing.final_price;
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

  // Operational rules
  if (updates.operationalRules !== undefined) {
    updatePayload.operational_rules = updates.operationalRules;
  }

  // 🔒 CHAMPS VERROUILLÉS : Ces champs ne peuvent PAS être modifiés
  // Ils ont été validés lors de l'acceptation de la candidature :
  // - title (titre de l'offre)
  // - description (description de l'offre)
  // - locationCity (localisation de base)
  // - locationPostalCode (code postal)
  // - vehicleCount (nombre de véhicules)
  // - finalPrice (prix total convenu)
  // - detailer_id (detailer sélectionné)
  // 
  // Si ces champs sont fournis dans updates, on les ignore silencieusement
  // pour éviter les erreurs, mais ils ne seront pas mis à jour.
  
  // ⚠️ Note : Le prix total (finalPrice) est également verrouillé,
  // mais on le laisse dans le code ci-dessus pour le calcul de deposit/remaining
  // Cependant, on ne met pas à jour final_price dans la DB si fourni

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

  // 5) 🆕 ENREGISTRER L'ACCEPTATION DE LA COMPANY
  // Horodatage + version du contrat au moment de l'acceptation
  const contractVersion = existing.contract_version || 1;
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from("mission_agreements")
    .update({
      status: "waiting_for_detailer_confirmation",
      agreement_pdf_url: pdfUrl || existing.agreement_pdf_url,
      company_accepted_at: now, // 🆕 Horodatage acceptation company
      contract_version_at_acceptance: contractVersion, // 🆕 Version au moment de l'acceptation
      updated_at: now,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  const updatedAgreement = mapMissionAgreementRowToDto(data);

  // 6) Envoyer notification au detailer
  try {
    if (updatedAgreement.detailerId) {
      const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
      await sendNotificationWithDeepLink({
        userId: updatedAgreement.detailerId,
        title: "Nouveau contrat de mission",
        message: `Un nouveau contrat de mission "${updatedAgreement.title || 'votre mission'}" vous attend`,
        type: "mission_agreement_pending",
        id: id,
      });
    } else {
      console.warn(`[MISSION AGREEMENT] Cannot send notification to detailer: detailerId is null for agreement ${id}`);
    }
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

  // 3) 🆕 ENREGISTRER L'ACCEPTATION DU DETAILER
  // Horodatage + version du contrat au moment de l'acceptation
  const contractVersion = existing.contract_version || 1;
  const now = new Date().toISOString();

  // 4) 🆕 CRÉER LE PAYMENT INTENT PRINCIPAL (GARANTIE) AVANT DE CHANGER LE STATUT
  // Après double acceptation, créer un PaymentIntent principal pour le montant total
  // Ce PaymentIntent sert de "garantie" et sera utilisé pour les paiements programmés
  let mainPaymentIntentId = null;
  
  try {
    const { createSepaPaymentIntent } = await import("./sepaDirectDebit.service.js");
    
    // Vérifier le SEPA mandate
    const { getSepaMandate } = await import("./sepaDirectDebit.service.js");
    const sepaMandate = await getSepaMandate(existing.company_id);
    
    if (!sepaMandate || sepaMandate.status !== "active") {
      console.warn(`⚠️ [MISSION AGREEMENT] SEPA mandate not active for company ${existing.company_id}. Payment Intent will not be created.`);
    } else {
      // Créer le PaymentIntent principal pour le montant total (garantie)
      const mainPaymentIntent = await createSepaPaymentIntent({
        companyUserId: existing.company_id,
        amount: existing.final_price, // 3000€
        currency: "eur",
        paymentMethodId: null,
        applicationFeeAmount: null, // Pas de commission sur le PaymentIntent principal
        captureMethod: "manual", // Pas capturé immédiatement (garantie)
        metadata: {
          missionAgreementId: id,
          type: "mission_main_guarantee",
          userId: existing.company_id,
        },
      });

      mainPaymentIntentId = mainPaymentIntent.id;
      console.log(`✅ [MISSION AGREEMENT] Main Payment Intent created for agreement ${id}: ${mainPaymentIntent.id} (${existing.final_price}€)`);
    }
  } catch (paymentError) {
    console.error(`❌ [MISSION AGREEMENT] Error creating main payment intent for agreement ${id}:`, paymentError);
    // ⚠️ IMPORTANT : Ne pas faire échouer l'acceptation si la création du PaymentIntent échoue
    // La company pourra créer les paiements manuellement plus tard
    // On continue quand même pour que le contrat soit accepté
  }

  // 5) 🆕 JOUR 0 — ACTIVATION DU CONTRAT
  // Mettre à jour le statut à "active" (mission prête à démarrer)
  // Le statut "active" indique que la mission peut démarrer et que les paiements du jour 1 seront capturés automatiquement
  // 
  // 🟢 NOUVEAU FLOW : Jour 0 = Activation du contrat
  // - SEPA mandate validé
  // - Carte / compte vérifié
  // - Prélèvement de l'acompte (600€) + Commission NIOS (210€) programmé pour Jour 1
  const { data, error } = await supabase
    .from("mission_agreements")
    .update({
      status: "active", // Mission active, prête pour les paiements du jour 1
      stripe_payment_intent_id: mainPaymentIntentId, // PaymentIntent principal (garantie)
      detailer_accepted_at: now, // 🆕 Horodatage acceptation detailer
      contract_version_at_acceptance: contractVersion, // 🆕 Version au moment de l'acceptation
      updated_at: now,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  const updatedAgreement = mapMissionAgreementRowToDto(data);
  
  console.log(`✅ [MISSION AGREEMENT] Status updated to "active" for agreement ${id}`);
  console.log(`ℹ️ [MISSION AGREEMENT] Agreement details: finalPrice=${updatedAgreement.finalPrice}€, depositAmount=${updatedAgreement.depositAmount}€, stripeConnectedAccountId=${updatedAgreement.stripeConnectedAccountId}`);

  // 6) 🆕 GÉNÉRER LE PDF DU CONTRAT (si pas déjà généré)
  // Le PDF doit être généré avec les informations finales après acceptation par le detailer
  let pdfUrl = existing.agreement_pdf_url;
  if (!pdfUrl) {
    try {
      const { generateAndSaveMissionAgreementPdf } = await import("./missionAgreementPdf.service.js");
      const generatedPdf = await generateAndSaveMissionAgreementPdf(id);
      pdfUrl = generatedPdf;
      
      // Mettre à jour l'URL du PDF dans la base de données
      await supabase
        .from("mission_agreements")
        .update({ agreement_pdf_url: pdfUrl })
        .eq("id", id);
      
      console.log(`✅ [MISSION AGREEMENT] PDF generated and saved for agreement ${id}`);
    } catch (pdfError) {
      console.error("[MISSION AGREEMENT] Failed to generate PDF on detailer acceptance:", pdfError);
      // Ne pas bloquer l'acceptation si le PDF échoue
    }
  }

  // 7) 🆕 CAPTURE IMMÉDIATE DES PAIEMENTS (T0 - Débit automatique)
  // Dès que le detailer accepte:
  // - Commission NIOS (7%) : Capturée immédiatement et envoyée à NIOS
  // - Acompte detailer (20%) : Capturé immédiatement mais "hold" jusqu'à J+1
  try {
    console.log(`🔄 [MISSION AGREEMENT] Starting immediate payment capture for agreement ${id}...`);
    const { captureImmediatePaymentsOnAcceptance } = await import("./missionPaymentImmediateCapture.service.js");
    const captureResult = await captureImmediatePaymentsOnAcceptance(id);
    console.log(`✅ [MISSION AGREEMENT] Immediate payments captured for agreement ${id} (T0): ${captureResult.totalCaptured}€`);
    console.log(`   - Commission: ${captureResult.commissionCaptured}€ (sent to NIOS immediately)`);
    console.log(`   - Deposit: ${captureResult.depositCaptured}€ (held until J+1)`);
    
    // 7.2) Créer le plan de paiement intelligent (paiements mensuels/finaux)
    try {
      const { createIntelligentPaymentSchedule } = await import("./missionPaymentScheduleIntelligent.service.js");
      // authorizeAll = true : autorise tous les paiements immédiatement
      await createIntelligentPaymentSchedule(id, true);
      console.log(`✅ [MISSION AGREEMENT] Payment schedule created for agreement ${id} (remaining payments)`);
    } catch (scheduleError) {
      console.error(`❌ [MISSION AGREEMENT] Error creating payment schedule for agreement ${id}:`, scheduleError);
      // Ne pas faire échouer l'acceptation si la création du plan de paiement échoue
      // Les paiements pourront être créés manuellement plus tard
    }
  } catch (captureError) {
    console.error(`❌ [MISSION AGREEMENT] CRITICAL ERROR: Failed to capture immediate payments for agreement ${id}:`, captureError);
    console.error(`❌ [MISSION AGREEMENT] Error details:`, captureError.message);
    console.error(`❌ [MISSION AGREEMENT] Stack trace:`, captureError.stack);
    // ⚠️ IMPORTANT : Ne pas faire échouer l'acceptation, mais logger l'erreur de manière visible
    // Les paiements pourront être créés manuellement plus tard via le dashboard
  }

  // 8) 🆕 ENVOYER DES NOTIFICATIONS DÉTAILLÉES
  try {
    const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
    
    // Calculer les montants pour les notifications
    const totalAmount = updatedAgreement.finalPrice;
    const commissionAmount = Math.round(totalAmount * 0.07 * 100) / 100; // 7%
    const depositAmount = updatedAgreement.depositAmount || Math.round((totalAmount * 0.20) * 100) / 100; // 20%
    const totalDebited = commissionAmount + depositAmount;
    
    // 8.1) Notification à la COMPANY (détails du débit)
    if (updatedAgreement.companyId) {
      await sendNotificationWithDeepLink({
        userId: updatedAgreement.companyId,
        title: "✅ Contrat accepté - Paiements débités",
        message: `Le detailer a accepté le contrat "${updatedAgreement.title || 'votre mission'}".\n\n💳 Acompte: ${depositAmount}€ débité\n🧾 Commission NIOS: ${commissionAmount}€ débitée\n💰 Total: ${totalDebited}€\n\n🚀 La mission est officiellement lancée.`,
        type: "mission_agreement_accepted",
        id: id,
      });
    } else {
      console.warn(`[MISSION AGREEMENT] Cannot send notification to company: companyId is null for agreement ${id}`);
    }
    
    // 8.2) Notification au DETAILER (détails de réception)
    if (updatedAgreement.detailerId) {
      const startDate = new Date(updatedAgreement.startDate);
      const jPlusOne = new Date(startDate.getTime() + 24 * 60 * 60 * 1000); // J+1
      const jPlusOneFormatted = jPlusOne.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
      
      await sendNotificationWithDeepLink({
        userId: updatedAgreement.detailerId,
        title: "✅ Contrat validé - Acompte sécurisé",
        message: `Contrat "${updatedAgreement.title || 'la mission'}" validé.\n\n💰 Acompte de ${depositAmount}€ sécurisé chez NIOS\n📅 Il vous sera versé le ${jPlusOneFormatted} (J+1)\n🧾 Paiements suivants planifiés automatiquement\n\n🚀 Vous pouvez commencer la mission en toute sécurité.`,
        type: "mission_agreement_accepted",
        id: id,
      });
    } else {
      console.warn(`[MISSION AGREEMENT] Cannot send notification to detailer: detailerId is null for agreement ${id}`);
    }
    
    console.log(`✅ [MISSION AGREEMENT] Notifications sent to company and detailer`);
  } catch (notifError) {
    console.error("[MISSION AGREEMENT] Notification send failed:", notifError);
    // Ne pas faire échouer l'acceptation si la notification échoue
  }

  return updatedAgreement;
}
