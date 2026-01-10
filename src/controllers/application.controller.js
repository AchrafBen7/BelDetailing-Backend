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
    
    return res.status(201).json(created);
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
    await acceptApplication(id, req.user);
    
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
          },
        });
      }
    } catch (notifError) {
      console.error("[APPLICATIONS] Notification send failed:", notifError);
      // ⚠️ Ne pas bloquer l'acceptation si la notification échoue
    }
    
    return res.json({ success: true });
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
