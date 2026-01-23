// src/controllers/missionAgreement.controller.js
import {
  getMissionAgreementById,
  getMissionAgreementsForUser,
  updateMissionAgreementStatus,
  updateMissionAgreementStripeInfo,
  updateMissionAgreementDates,
  updateMissionAgreementPdfUrl,
} from "../services/missionAgreement.service.js";
import {
  updateMissionAgreement,
  confirmMissionAgreementByCompany,
  acceptMissionAgreementByDetailer,
} from "../services/missionAgreementUpdate.service.js";
import {
  createIntelligentPaymentSchedule,
  getPaymentScheduleSummary,
} from "../services/missionPaymentScheduleIntelligent.service.js";

/**
 * 🔹 GET /api/v1/mission-agreements/:id
 * Récupérer un Mission Agreement par ID
 */
export async function getMissionAgreementController(req, res) {
  try {
    const { id } = req.params;
    const agreement = await getMissionAgreementById(id);

    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    // Vérifier que l'utilisateur a le droit de voir cet agreement
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole === "company" && agreement.companyId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (userRole === "provider" && agreement.detailerId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Admin peut voir tous les agreements
    if (userRole !== "admin" && userRole !== "company" && userRole !== "provider") {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json({ data: agreement });
  } catch (err) {
    console.error("[MISSION AGREEMENT] get error:", err);
    return res.status(500).json({ error: "Could not fetch mission agreement" });
  }
}

/**
 * 🔹 GET /api/v1/mission-agreements
 * Récupérer les Mission Agreements de l'utilisateur connecté
 */
export async function listMissionAgreementsController(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { status } = req.query; // Filtrer par statut (optionnel)

    if (userRole !== "company" && userRole !== "provider") {
      return res.status(403).json({ error: "Only companies and providers can view mission agreements" });
    }

    const agreements = await getMissionAgreementsForUser(userId, userRole, status || null);

    return res.json({ data: agreements });
  } catch (err) {
    console.error("[MISSION AGREEMENT] list error:", err);
    return res.status(500).json({ error: "Could not fetch mission agreements" });
  }
}

/**
 * 🔹 PATCH /api/v1/mission-agreements/:id/status
 * Mettre à jour le statut d'un Mission Agreement
 */
export async function updateMissionAgreementStatusController(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: "Missing status" });
    }

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(id);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    // Seule la company ou le detailer peuvent mettre à jour le statut
    if (userRole === "company" && agreement.companyId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (userRole === "provider" && agreement.detailerId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updated = await updateMissionAgreementStatus(id, status);

    return res.json({ data: updated });
  } catch (err) {
    console.error("[MISSION AGREEMENT] update status error:", err);
    const statusCode = err.message?.includes("Invalid status") ? 400 : 500;
    return res.status(statusCode).json({ error: err.message || "Could not update mission agreement status" });
  }
}

/**
 * 🔹 PATCH /api/v1/mission-agreements/:id/stripe
 * Mettre à jour les informations Stripe d'un Mission Agreement
 */
export async function updateMissionAgreementStripeController(req, res) {
  try {
    const { id } = req.params;
    const { paymentIntentId, subscriptionId, customerId, connectedAccountId } = req.body;

    // Vérifier les permissions (seule la company peut mettre à jour les infos Stripe)
    const agreement = await getMissionAgreementById(id);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    if (req.user.role !== "company" || agreement.companyId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updated = await updateMissionAgreementStripeInfo(id, {
      paymentIntentId,
      subscriptionId,
      customerId,
      connectedAccountId,
    });

    return res.json({ data: updated });
  } catch (err) {
    console.error("[MISSION AGREEMENT] update stripe error:", err);
    return res.status(500).json({ error: "Could not update mission agreement stripe info" });
  }
}

/**
 * 🔹 PATCH /api/v1/mission-agreements/:id/dates
 * Mettre à jour les dates d'un Mission Agreement
 */
export async function updateMissionAgreementDatesController(req, res) {
  try {
    const { id } = req.params;
    const { startDate, endDate, estimatedDurationDays } = req.body;

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(id);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    // Company ou detailer peuvent mettre à jour les dates
    if (userRole === "company" && agreement.companyId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (userRole === "provider" && agreement.detailerId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updated = await updateMissionAgreementDates(id, {
      startDate,
      endDate,
      estimatedDurationDays,
    });

    return res.json({ data: updated });
  } catch (err) {
    console.error("[MISSION AGREEMENT] update dates error:", err);
    return res.status(500).json({ error: "Could not update mission agreement dates" });
  }
}

/**
 * 🔹 PATCH /api/v1/mission-agreements/:id/pdf
 * Mettre à jour l'URL du PDF Mission Agreement
 */
export async function updateMissionAgreementPdfController(req, res) {
  try {
    const { id } = req.params;
    const { pdfUrl } = req.body;

    if (!pdfUrl) {
      return res.status(400).json({ error: "Missing pdfUrl" });
    }

    // Vérifier les permissions (seule la company peut mettre à jour le PDF)
    const agreement = await getMissionAgreementById(id);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    if (req.user.role !== "company" || agreement.companyId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updated = await updateMissionAgreementPdfUrl(id, pdfUrl);

    return res.json({ data: updated });
  } catch (err) {
    console.error("[MISSION AGREEMENT] update pdf error:", err);
    return res.status(500).json({ error: "Could not update mission agreement PDF URL" });
  }
}

/**
 * 🔹 PATCH /api/v1/mission-agreements/:id
 * Mettre à jour un Mission Agreement (company édition)
 */
export async function updateMissionAgreementController(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can update mission agreements" });
    }

    const updated = await updateMissionAgreement(id, updates, req.user.id);

    return res.json({ data: updated });
  } catch (err) {
    console.error("[MISSION AGREEMENT] update error:", err);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message || "Could not update mission agreement" });
  }
}

/**
 * 🔹 POST /api/v1/mission-agreements/:id/confirm
 * Confirmer le Mission Agreement côté company
 */
export async function confirmMissionAgreementController(req, res) {
  try {
    const { id } = req.params;

    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can confirm mission agreements" });
    }

    const confirmed = await confirmMissionAgreementByCompany(id, req.user.id);

    return res.json({ data: confirmed });
  } catch (err) {
    console.error("[MISSION AGREEMENT] confirm error:", err);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message || "Could not confirm mission agreement" });
  }
}

/**
 * 🔹 POST /api/v1/mission-agreements/:id/accept
 * Accepter le Mission Agreement côté detailer
 */
export async function acceptMissionAgreementController(req, res) {
  try {
    const { id } = req.params;

    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can accept mission agreements" });
    }

    const accepted = await acceptMissionAgreementByDetailer(id, req.user.id);

    return res.json({ data: accepted });
  } catch (err) {
    console.error("[MISSION AGREEMENT] accept error:", err);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message || "Could not accept mission agreement" });
  }
}

/**
 * 🔹 POST /api/v1/mission-agreements/:id/create-payments
 * Créer le plan de paiement intelligent pour un Mission Agreement
 * Nécessite : statut agreement_fully_confirmed + SEPA mandate actif
 */
export async function createMissionPaymentsController(req, res) {
  try {
    const { id } = req.params;

    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can create payment schedules" });
    }

    // Vérifier que l'agreement existe et appartient à cette company
    const agreement = await getMissionAgreementById(id);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    if (agreement.companyId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Vérifier que le statut est agreement_fully_confirmed
    if (agreement.status !== "agreement_fully_confirmed") {
      return res.status(400).json({
        error: `Cannot create payments. Agreement status must be 'agreement_fully_confirmed'. Current status: ${agreement.status}`,
      });
    }

    // Vérifier que les dates sont définies
    if (!agreement.startDate || !agreement.endDate) {
      return res.status(400).json({
        error: "Cannot create payments. Start date and end date must be defined.",
      });
    }

    // Vérifier le SEPA mandate
    const { getSepaMandate } = await import("../services/sepaDirectDebit.service.js");
    const sepaMandate = await getSepaMandate(req.user.id);

    if (!sepaMandate || sepaMandate.status !== "active") {
      return res.status(400).json({
        error: "SEPA_MANDATE_REQUIRED",
        message: "Un mandat SEPA actif est requis pour créer les paiements. Veuillez configurer votre mandat SEPA.",
        requiresSepaSetup: true,
      });
    }

    // Vérifier si des paiements existent déjà
    const { getMissionPaymentsForAgreement } = await import("../services/missionPayment.service.js");
    const existingPayments = await getMissionPaymentsForAgreement(id);
    
    if (existingPayments.length > 0) {
      return res.status(400).json({
        error: "Payments already exist for this agreement",
        payments: existingPayments,
      });
    }

    // Créer le plan de paiement intelligent
    const paymentSchedule = await createIntelligentPaymentSchedule(id, true); // authorizeAll = true

    // Mettre à jour le statut à "active" (premier paiement autorisé)
    await updateMissionAgreementStatus(id, "active");

    return res.json({
      data: {
        agreementId: id,
        schedule: paymentSchedule,
        message: "Payment schedule created successfully",
      },
    });
  } catch (err) {
    console.error("[MISSION AGREEMENT] create payments error:", err);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message || "Could not create payment schedule" });
  }
}

/**
 * 🔹 GET /api/v1/mission-agreements/:id/payment-schedule
 * Récupérer le récapitulatif du plan de paiement
 */
export async function getPaymentScheduleController(req, res) {
  try {
    const { id } = req.params;

    // Vérifier que l'agreement existe
    const agreement = await getMissionAgreementById(id);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    // Vérifier les permissions
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole === "company" && agreement.companyId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (userRole === "provider" && agreement.detailerId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const summary = await getPaymentScheduleSummary(id);

    return res.json({ data: summary });
  } catch (err) {
    console.error("[MISSION AGREEMENT] get payment schedule error:", err);
    return res.status(500).json({ error: err.message || "Could not fetch payment schedule" });
  }
}
