import {
  getApplicationsForOffer,
  applyToOffer,
  withdrawApplication,
  acceptApplication,
  refuseApplication,
  getMyApplications,
} from "../services/application.service.js";
// ⚠️ REMOVED: createBookingFromApplication - Les missions (offers) ne créent PAS de booking
// Les bookings sont pour les services ponctuels avec start_time/end_time précis
// Les missions sont gérées via Mission Agreement uniquement
import { createMissionAgreement } from "../services/missionAgreement.service.js";
import { sendNotificationToUser } from "../services/onesignal.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";

// 🔹 GET /api/v1/offers/:offerId/applications
export async function listApplicationsForOffer(req, res) {
  try {
    const { offerId } = req.params;
    // optional: vérifier role === "company" si tu veux restreindre
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can view applications" });
    }

    const items = await getApplicationsForOffer(offerId);
    return res.json({ data: items });
  } catch (err) {
    console.error("[APPLICATIONS] list error:", err);
    return res.status(500).json({ error: "Could not fetch applications" });
  }
}

// 🔹 POST /api/v1/offers/:offerId/apply  (provider)
export async function applyToOfferController(req, res) {
  try {
    // ✅ BLOQUER les provider_passionate (pas de B2B)
    if (req.user.role === "provider_passionate") {
      return res.status(403).json({ 
        error: "Passionate detailers cannot apply to offers. Please upgrade to Pro account (VAT required)." 
      });
    }
    
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can apply" });
    }

    const { offerId } = req.params;
    const created = await applyToOffer(offerId, req.body, req.user);
    
    // ✅ ENVOYER NOTIFICATION À LA COMPANY (nouvelle candidature reçue)
    try {
      // Récupérer les infos de l'offre pour connaître created_by
      const { data: offer, error: offerError } = await supabase
        .from("offers")
        .select("id, title, created_by")
        .eq("id", offerId)
        .single();
      
      if (!offerError && offer && offer.created_by) {
        // Récupérer les infos du provider pour le message
        const { data: providerProfile } = await supabase
          .from("provider_profiles")
          .select("display_name")
          .eq("user_id", req.user.id)
          .maybeSingle();
        
        const providerName = providerProfile?.display_name || created.providerName || "Un prestataire";
        
        const { sendNotificationWithDeepLink } = await import("../services/onesignal.service.js");
        await sendNotificationWithDeepLink({
          userId: offer.created_by, // Company reçoit la notification
          title: "Nouvelle candidature",
          message: `${providerName} a postulé pour votre offre "${offer.title}"`,
          type: "application_received",
          id: created.id,
        });
      }
    } catch (notifError) {
      console.error("[APPLICATIONS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer la candidature si la notification échoue
    }
    
    return res.status(201).json({ data: created });
  } catch (err) {
    console.error("[APPLICATIONS] apply error:", err);
    const status = err.statusCode || 500;
    // ✅ Renvoyer le message d'erreur réel pour que l'utilisateur sache pourquoi la candidature a échoué
    const errorMessage = err.message || "Could not apply to offer";
    return res.status(status).json({ error: errorMessage });
  }
}

// 🔹 POST /api/v1/applications/:id/withdraw  (provider)
export async function withdrawApplicationController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can withdraw applications" });
    }

    const { id } = req.params;
    await withdrawApplication(id, req.user);
    return res.json({ success: true });
  } catch (err) {
    console.error("[APPLICATIONS] withdraw error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not withdraw application" });
  }
}

// 🔹 POST /api/v1/applications/:id/accept  (company)
export async function acceptApplicationController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can accept applications" });
    }

    const { id } = req.params;
    const { finalPrice, depositPercentage, paymentSchedule } = req.body; 
    // finalPrice : Prix final accepté
    // depositPercentage : Pourcentage d'acompte (20, 30, etc.)
    // paymentSchedule : Plan de paiement JSON (optionnel, défaut: one_shot)
    
    // 🔒 SÉCURITÉ SEPA : Vérifier que la company a un mandate SEPA actif
    // Selon la documentation Stripe, un mandate SEPA "active" est requis pour effectuer des prélèvements
    const { getSepaMandate } = await import("../services/sepaDirectDebit.service.js");
    
    let sepaMandate;
    try {
      sepaMandate = await getSepaMandate(req.user.id);
    } catch (sepaError) {
      console.error("[APPLICATIONS] Error checking SEPA mandate:", sepaError);
      return res.status(500).json({ 
        error: "Error checking SEPA mandate. Please try again or contact support." 
      });
    }
    
    if (!sepaMandate) {
      return res.status(400).json({ 
        error: "SEPA mandate required. Please set up SEPA Direct Debit before accepting applications.",
        code: "SEPA_MANDATE_MISSING"
      });
    }
    
    // Vérifier que le mandate est actif (selon Stripe, seul un mandate "active" permet les prélèvements)
    if (sepaMandate.status !== "active") {
      const statusMessages = {
        "pending": "Votre mandat SEPA est en attente de confirmation. Veuillez compléter la configuration SEPA.",
        "inactive": "Votre mandat SEPA est inactif. Veuillez configurer un nouveau mandat SEPA.",
        "canceled": "Votre mandat SEPA a été annulé. Veuillez configurer un nouveau mandat SEPA.",
      };
      
      return res.status(400).json({ 
        error: statusMessages[sepaMandate.status] || `SEPA mandate is not active. Current status: ${sepaMandate.status}. Please complete the SEPA setup.`,
        code: "SEPA_MANDATE_NOT_ACTIVE",
        status: sepaMandate.status
      });
    }
    
    console.log("[APPLICATIONS] ✅ SEPA mandate validated:", sepaMandate.id, "status:", sepaMandate.status);
    
    // 1) Accepter la candidature (met à jour le statut, calcule les montants, rejette les autres)
    const acceptResult = await acceptApplication(id, finalPrice, depositPercentage, req.user);
    
    // 2) Récupérer les dates de l'offre si elles existent
    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select("start_date, end_date")
      .eq("id", acceptResult.offerId)
      .maybeSingle();
    
    if (offerError) {
      console.warn("[APPLICATIONS] Error fetching offer dates:", offerError);
    }
    
    // 3) Créer le Mission Agreement (PAS de booking pour les missions/offers)
    // ⚠️ IMPORTANT : Les missions (offers) ne créent PAS de booking car :
    // - Les bookings sont pour les services ponctuels avec start_time/end_time précis
    // - Les missions sont gérées via Mission Agreement avec startDate/endDate
    // - Les paiements pour les missions sont gérés via Mission Payments, pas via bookings
    const missionAgreement = await createMissionAgreement({
      applicationId: id,
      offerId: acceptResult.offerId,
      companyId: acceptResult.companyId,
      detailerId: acceptResult.detailerId,
      finalPrice: acceptResult.finalPrice,
      depositPercentage: acceptResult.depositPercentage,
      paymentSchedule: paymentSchedule || { type: "one_shot" },
      offerData: {
        title: acceptResult.offerTitle,
        description: acceptResult.offerDescription,
        vehicleCount: acceptResult.vehicleCount,
        city: acceptResult.city,
        postalCode: acceptResult.postalCode,
        // 🆕 Dates de l'offre (si définies)
        startDate: offer?.start_date || null,
        endDate: offer?.end_date || null,
      },
    });
    
    // ✅ ENVOYER NOTIFICATION AU PROVIDER (candidature acceptée)
    try {
      // Récupérer les infos de l'application pour connaître provider_id et offer_id
      const { data: application, error: appError } = await supabase
        .from("applications")
        .select("id, provider_id, offer_id")
        .eq("id", id)
        .single();
      
      if (!appError && application && application.provider_id) {
        // Récupérer les infos de l'offre pour le message
        const { data: offer } = await supabase
          .from("offers")
          .select("title")
          .eq("id", application.offer_id)
          .maybeSingle();
        
        const offerTitle = offer?.title || "votre offre";
        
        const { sendNotificationWithDeepLink } = await import("../services/onesignal.service.js");
        await sendNotificationWithDeepLink({
          userId: application.provider_id, // Provider reçoit la notification
          title: "Candidature acceptée",
          message: `Votre candidature pour "${offerTitle}" a été acceptée`,
          type: "application_accepted",
          id: missionAgreement.id, // Deep link vers la mission
        });
      }
    } catch (notifError) {
      console.error("[APPLICATIONS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer l'acceptation si la notification échoue
    }
    
    // ⚠️ IMPORTANT : Ne PAS créer les paiements ici
    // Les paiements seront créés seulement après :
    // 1. Company confirme le contrat (draft → waiting_for_detailer_confirmation)
    // 2. Detailer accepte le contrat (waiting_for_detailer_confirmation → agreement_fully_confirmed)
    // 3. Company paie (agreement_fully_confirmed → active + paiements créés)
    
    // ⚠️ IMPORTANT : Ne PAS générer le PDF ici
    // Le PDF sera généré automatiquement lors de la confirmation par la company
    // Cela permet d'avoir les dates et prix finaux dans le PDF

    // ✅ CRÉER LA CONVERSATION DE CHAT AUTOMATIQUEMENT
    try {
      const { createMissionChat } = await import("../services/missionChat.service.js");
      const conversation = await createMissionChat(missionAgreement.id);
      if (conversation) {
        console.log(`✅ [APPLICATIONS] Chat conversation created for agreement ${missionAgreement.id}`);
      }
    } catch (chatError) {
      console.error("[APPLICATIONS] Failed to create chat conversation:", chatError);
      // Ne pas faire échouer l'acceptation si la création de la conversation échoue
      // La conversation pourra être créée manuellement plus tard
    }
    
    // ✅ Récupérer l'application complète pour la réponse iOS
    const { mapApplicationRowToDto } = await import("../services/application.service.js");
    const { data: applicationRow, error: appFetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", id)
      .single();
    
    const applicationDto = appFetchError ? null : mapApplicationRowToDto(applicationRow);
    
    // ✅ Format de réponse compatible avec AcceptApplicationResponse (iOS)
    return res.json({ 
      data: {
        missionAgreement: {
          id: missionAgreement.id,
          offerId: missionAgreement.offerId,
          companyId: missionAgreement.companyId,
          detailerId: missionAgreement.detailerId,
          finalPrice: missionAgreement.finalPrice,
          depositPercentage: missionAgreement.depositPercentage,
          depositAmount: missionAgreement.depositAmount,
          remainingAmount: missionAgreement.remainingAmount,
          status: missionAgreement.status,
          createdAt: missionAgreement.createdAt,
          pdfUrl: missionAgreement.pdfUrl,
        },
        application: applicationDto, // Application complète
        booking: null, // ⚠️ Pas de booking pour les missions - gérées via Mission Agreement uniquement
        paymentIntent: null, // ⚠️ Les paiements sont créés plus tard après confirmation du contrat
      }
    });
  } catch (err) {
    console.error("[APPLICATIONS] accept error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not accept application" });
  }
}

// 🔹 POST /api/v1/applications/:id/refuse  (company)
export async function refuseApplicationController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can refuse applications" });
    }

    const { id } = req.params;
    await refuseApplication(id, req.user);
    
    // ✅ ENVOYER NOTIFICATION AU PROVIDER (candidature refusée)
    try {
      // Récupérer les infos de l'application pour connaître provider_id et offer_id
      const { data: application, error: appError } = await supabase
        .from("applications")
        .select("id, provider_id, offer_id")
        .eq("id", id)
        .single();
      
      if (!appError && application && application.provider_id) {
        // Récupérer les infos de l'offre pour le message
        const { data: offer } = await supabase
          .from("offers")
          .select("title")
          .eq("id", application.offer_id)
          .maybeSingle();
        
        const offerTitle = offer?.title || "votre offre";
        
        const { sendNotificationWithDeepLink } = await import("../services/onesignal.service.js");
        await sendNotificationWithDeepLink({
          userId: application.provider_id, // Provider reçoit la notification
          title: "Candidature refusée",
          message: `Votre candidature pour "${offerTitle}" a été refusée`,
          type: "application_refused",
          id: id,
        });
      }
    } catch (notifError) {
      console.error("[APPLICATIONS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer le refus si la notification échoue
    }
    
    return res.json({ success: true });
  } catch (err) {
    console.error("[APPLICATIONS] refuse error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not refuse application" });
  }
}

// 🔹 GET /api/v1/applications/me  (provider)
export async function getMyApplicationsController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can view their applications" });
    }

    const items = await getMyApplications(req.user.id);
    return res.json({ data: items });
  } catch (err) {
    console.error("[APPLICATIONS] getMyApplications error:", err);
    return res.status(500).json({ error: "Could not fetch applications" });
  }
}
