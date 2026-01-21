// src/controllers/missionPaymentSchedule.controller.js
import {
  createInitialMissionPayments,
  authorizeAllPayments,
  getNextPaymentToCapture,
  getPaymentSummary,
} from "../services/missionPaymentSchedule.service.js";
import { getMissionAgreementById } from "../services/missionAgreement.service.js";
import { captureMissionPayment } from "../services/missionPaymentStripe.service.js";

/**
 * 🔹 POST /api/v1/mission-payments/schedule/create
 * Créer les paiements initiaux pour un Mission Agreement
 */
export async function createInitialPaymentsController(req, res) {
  try {
    const { missionAgreementId, authorizeAll } = req.body;

    if (!missionAgreementId) {
      return res.status(400).json({ error: "Missing missionAgreementId" });
    }

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userRole = req.user.role;
    const userId = req.user.id;

    // Seule la company propriétaire ou un admin peut créer les paiements
    if (userRole !== "admin" && (userRole !== "company" || agreement.companyId !== userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const payments = await createInitialMissionPayments(
      missionAgreementId,
      authorizeAll !== false // Par défaut, autoriser tous les paiements
    );

    return res.status(201).json({ data: payments });
  } catch (err) {
    console.error("[MISSION PAYMENT SCHEDULE] create error:", err);
    return res.status(400).json({ error: err.message || "Could not create initial payments" });
  }
}

/**
 * 🔹 POST /api/v1/mission-payments/schedule/authorize-all
 * Autoriser tous les paiements d'un Mission Agreement
 */
export async function authorizeAllPaymentsController(req, res) {
  try {
    const { missionAgreementId } = req.body;

    if (!missionAgreementId) {
      return res.status(400).json({ error: "Missing missionAgreementId" });
    }

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userRole = req.user.role;
    const userId = req.user.id;

    // Seule la company propriétaire ou un admin peut autoriser les paiements
    if (userRole !== "admin" && (userRole !== "company" || agreement.companyId !== userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const authorizedPayments = await authorizeAllPayments(missionAgreementId);

    return res.json({ data: authorizedPayments });
  } catch (err) {
    console.error("[MISSION PAYMENT SCHEDULE] authorize-all error:", err);
    return res.status(400).json({ error: err.message || "Could not authorize payments" });
  }
}

/**
 * 🔹 GET /api/v1/mission-payments/schedule/next
 * Récupérer le prochain paiement à capturer
 */
export async function getNextPaymentController(req, res) {
  try {
    const { missionAgreementId } = req.query;

    if (!missionAgreementId) {
      return res.status(400).json({ error: "Missing missionAgreementId" });
    }

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userRole = req.user.role;
    const userId = req.user.id;

    // Company ou detailer propriétaire, ou admin
    const isOwner = 
      (userRole === "company" && agreement.companyId === userId) ||
      (userRole === "provider" && agreement.detailerId === userId) ||
      userRole === "admin";

    if (!isOwner) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const nextPayment = await getNextPaymentToCapture(missionAgreementId);

    return res.json({ data: nextPayment });
  } catch (err) {
    console.error("[MISSION PAYMENT SCHEDULE] next error:", err);
    return res.status(400).json({ error: err.message || "Could not get next payment" });
  }
}

/**
 * 🔹 GET /api/v1/mission-payments/schedule/summary
 * Récupérer le récapitulatif des paiements
 */
export async function getPaymentSummaryController(req, res) {
  try {
    const { missionAgreementId } = req.query;

    if (!missionAgreementId) {
      return res.status(400).json({ error: "Missing missionAgreementId" });
    }

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userRole = req.user.role;
    const userId = req.user.id;

    // Company ou detailer propriétaire, ou admin
    const isOwner = 
      (userRole === "company" && agreement.companyId === userId) ||
      (userRole === "provider" && agreement.detailerId === userId) ||
      userRole === "admin";

    if (!isOwner) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const summary = await getPaymentSummary(missionAgreementId);

    return res.json({ data: summary });
  } catch (err) {
    console.error("[MISSION PAYMENT SCHEDULE] summary error:", err);
    return res.status(400).json({ error: err.message || "Could not get payment summary" });
  }
}

/**
 * 🔹 POST /api/v1/mission-payments/schedule/capture-next
 * Capturer le prochain paiement à capturer
 */
export async function captureNextPaymentController(req, res) {
  try {
    const { missionAgreementId } = req.body;

    if (!missionAgreementId) {
      return res.status(400).json({ error: "Missing missionAgreementId" });
    }

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userRole = req.user.role;
    const userId = req.user.id;

    // Seule la company propriétaire ou un admin peut capturer les paiements
    if (userRole !== "admin" && (userRole !== "company" || agreement.companyId !== userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Récupérer le prochain paiement à capturer
    const nextPayment = await getNextPaymentToCapture(missionAgreementId);

    if (!nextPayment) {
      return res.status(400).json({ error: "No payment ready to capture" });
    }

    // Capturer le paiement
    const captured = await captureMissionPayment(nextPayment.id);

    return res.json({ data: captured });
  } catch (err) {
    console.error("[MISSION PAYMENT SCHEDULE] capture-next error:", err);
    return res.status(400).json({ error: err.message || "Could not capture payment" });
  }
}
