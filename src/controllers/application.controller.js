import {
  getApplicationsForOffer,
  applyToOffer,
  withdrawApplication,
  acceptApplication,
  refuseApplication,
} from "../services/application.service.js";
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
        
        await sendNotificationToUser({
          userId: offer.created_by, // Company reçoit la notification
          title: "Nouvelle candidature",
          message: `${providerName} a postulé pour votre offre "${offer.title}"`,
          data: {
            type: "application_received",
            offer_id: offerId,
            application_id: created.id,
            provider_id: req.user.id,
          },
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
    return res.status(status).json({ error: "Could not apply to offer" });
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
    
    // 1) Accepter la candidature (met à jour le statut, calcule les montants, rejette les autres)
    const acceptResult = await acceptApplication(id, finalPrice, depositPercentage, req.user);
    
    // 2) Créer le Mission Agreement
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
        
        await sendNotificationToUser({
          userId: application.provider_id, // Provider reçoit la notification
          title: "Candidature acceptée",
          message: `Votre candidature pour "${offerTitle}" a été acceptée`,
          data: {
            type: "application_accepted",
            offer_id: application.offer_id,
            application_id: id,
            mission_agreement_id: missionAgreement.id,
          },
        });
      }
    } catch (notifError) {
      console.error("[APPLICATIONS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer l'acceptation si la notification échoue
    }
    
    // ✅ CRÉER LES PAIEMENTS INITIAUX AUTOMATIQUEMENT
    try {
      const { createInitialMissionPayments } = await import("../services/missionPaymentSchedule.service.js");
      await createInitialMissionPayments(missionAgreement.id, true); // authorizeAll = true
      console.log(`✅ [APPLICATIONS] Initial payments created for agreement ${missionAgreement.id}`);
    } catch (paymentError) {
      console.error("[APPLICATIONS] Failed to create initial payments:", paymentError);
      // Ne pas faire échouer l'acceptation si la création des paiements échoue
      // Les paiements pourront être créés manuellement plus tard
    }

    // ✅ GÉNÉRER LE PDF DU MISSION AGREEMENT AUTOMATIQUEMENT
    try {
      const { generateAndSaveMissionAgreementPdf } = await import("../services/missionAgreementPdf.service.js");
      await generateAndSaveMissionAgreementPdf(missionAgreement.id);
      console.log(`✅ [APPLICATIONS] PDF generated for agreement ${missionAgreement.id}`);
    } catch (pdfError) {
      console.error("[APPLICATIONS] Failed to generate PDF:", pdfError);
      // Ne pas faire échouer l'acceptation si la génération du PDF échoue
      // Le PDF pourra être généré manuellement plus tard
    }

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
    
    return res.json({ 
      data: {
        ...acceptResult,
        missionAgreement,
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
        
        await sendNotificationToUser({
          userId: application.provider_id, // Provider reçoit la notification
          title: "Candidature refusée",
          message: `Votre candidature pour "${offerTitle}" a été refusée`,
          data: {
            type: "application_refused",
            offer_id: application.offer_id,
            application_id: id,
          },
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
