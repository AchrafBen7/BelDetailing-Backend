import {
  getOffers,
  getOfferById,
  createOffer,
  updateOffer,
  closeOffer,
  reopenOffer,
  deleteOffer,
  getMyOffers,
} from "../services/offer.service.js";
import { invalidateOfferCache } from "../middlewares/cache.middleware.js";
import { getSepaMandate } from "../services/sepaDirectDebit.service.js";

export async function listOffers(req, res) {
  try {
    const { status, type } = req.query;
    const items = await getOffers({ status, type });
    return res.json({ data: items });
  } catch (err) {
    console.error("[OFFERS] list error:", err);
    return res.status(500).json({ error: "Could not fetch offers" });
  }
}

export async function getOffer(req, res) {
  try {
    const { id } = req.params;
    const item = await getOfferById(id);
    if (!item) {
      return res.status(404).json({ error: "Offer not found" });
    }
    return res.json(item);
  } catch (err) {
    console.error("[OFFERS] get error:", err);
    return res.status(500).json({ error: "Could not fetch offer" });
  }
}

export async function createOfferController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can create offers" });
    }

    // 🔥 VÉRIFICATION MANDAT SEPA OBLIGATOIRE
    // Une company doit avoir un mandat SEPA actif avant de pouvoir créer une offre
    console.log("🔄 [OFFERS] Checking SEPA mandate for company:", req.user.id);
    const sepaMandate = await getSepaMandate(req.user.id);
    
    // Accepter "active" et "pending" (pending = accepté par l'utilisateur, en attente de validation bancaire)
    if (!sepaMandate || (sepaMandate.status !== "active" && sepaMandate.status !== "pending")) {
      console.warn("⚠️ [OFFERS] No active/pending SEPA mandate found for company:", req.user.id);
      return res.status(400).json({ 
        error: "SEPA_MANDATE_REQUIRED",
        message: "Un mandat SEPA actif est requis pour créer une offre. Veuillez configurer votre mandat SEPA avant de continuer.",
        requiresSepaSetup: true
      });
    }
    
    console.log("✅ [OFFERS] Active SEPA mandate found:", sepaMandate.id);

    const created = await createOffer(req.body, req.user);
    
    // Invalider le cache de la liste des offres
    await invalidateOfferCache(created.id);
    
    // Envelopper dans { data: ... } pour cohérence avec les autres endpoints
    return res.status(201).json({ data: created });
  } catch (err) {
    console.error("[OFFERS] create error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not create offer" });
  }
}

export async function updateOfferController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can update offers" });
    }

    const { id } = req.params;
    const updated = await updateOffer(id, req.body, req.user);
    
    // Invalider le cache de l'offre modifiée
    await invalidateOfferCache(id);
    
    // Envelopper dans { data: ... } pour cohérence avec les autres endpoints
    return res.json({ data: updated });
  } catch (err) {
    console.error("[OFFERS] update error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not update offer" });
  }
}

export async function closeOfferController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can close offers" });
    }

    const { id } = req.params;
    const updated = await closeOffer(id, req.user);
    
    // Invalider le cache de l'offre fermée
    await invalidateOfferCache(id);
    
    // Envelopper dans { data: ... } pour cohérence avec les autres endpoints
    return res.json({ data: updated });
  } catch (err) {
    console.error("[OFFERS] close error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not close offer" });
  }
}

export async function reopenOfferController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can reopen offers" });
    }

    const { id } = req.params;
    const updated = await reopenOffer(id, req.user);
    
    // Invalider le cache de l'offre rouverte
    await invalidateOfferCache(id);
    
    return res.json({ data: updated });
  } catch (err) {
    console.error("[OFFERS] reopen error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Could not reopen offer" });
  }
}

export async function deleteOfferController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can delete offers" });
    }

    const { id } = req.params;
    await deleteOffer(id, req.user);
    
    // Invalider le cache de l'offre supprimée
    await invalidateOfferCache(id);
    
    return res.json({ success: true });
  } catch (err) {
    console.error("[OFFERS] delete error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "Could not delete offer" });
  }
}

/**
 * GET /api/v1/offers/my
 * Liste des offres créées par l'utilisateur connecté (company)
 */
export async function listMyOffersController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can view their own offers" });
    }

    const items = await getMyOffers(req.user.id);
    return res.json({ data: items });
  } catch (err) {
    console.error("[OFFERS] listMyOffers error:", err);
    return res.status(500).json({ error: "Could not fetch your offers" });
  }
}
