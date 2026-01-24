// src/controllers/missionPaymentInitial.controller.js
import { getMissionAgreementById } from "../services/missionAgreement.service.js";
import { getMissionPaymentsForAgreement } from "../services/missionPayment.service.js";
import { createInitialPayments } from "../services/missionPaymentInitial.service.js";

/**
 * 🔹 GET /api/v1/mission-agreements/:id/initial-payments
 * Récupérer les paiements initiaux (acompte + commission) pour un Mission Agreement
 */
export async function getInitialPaymentsController(req, res) {
  try {
    const { id } = req.params;

    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can view initial payments" });
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
        error: `Cannot view initial payments. Agreement status must be 'agreement_fully_confirmed'. Current status: ${agreement.status}`,
      });
    }

    // Récupérer les paiements initiaux (deposit + commission)
    const payments = await getMissionPaymentsForAgreement(id);
    const initialPayments = payments.filter(p => p.type === "deposit" || p.type === "commission");

    return res.json({
      data: initialPayments,
    });
  } catch (err) {
    console.error("[MISSION PAYMENT INITIAL] get error:", err);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message || "Could not fetch initial payments" });
  }
}

/**
 * 🔹 POST /api/v1/mission-agreements/:id/initial-payments/create
 * Créer les paiements initiaux si ils n'existent pas encore
 * (Fallback si la création automatique a échoué)
 */
export async function createInitialPaymentsController(req, res) {
  try {
    const { id } = req.params;

    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can create initial payments" });
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
        error: `Cannot create initial payments. Agreement status must be 'agreement_fully_confirmed'. Current status: ${agreement.status}`,
      });
    }

    // Vérifier si des paiements initiaux existent déjà
    const payments = await getMissionPaymentsForAgreement(id);
    const existingInitialPayments = payments.filter(p => p.type === "deposit" || p.type === "commission");
    
    if (existingInitialPayments.length > 0) {
      return res.status(400).json({
        error: "Initial payments already exist for this agreement",
        payments: existingInitialPayments,
      });
    }

    // Créer les paiements initiaux
    const initialPayments = await createInitialPayments(id);

    return res.json({
      data: initialPayments,
      message: "Initial payments created successfully",
    });
  } catch (err) {
    console.error("[MISSION PAYMENT INITIAL] create error:", err);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message || "Could not create initial payments" });
  }
}
