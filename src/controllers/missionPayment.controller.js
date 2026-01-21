// src/controllers/missionPayment.controller.js
import {
  createMissionPayment,
  getMissionPaymentById,
  getMissionPaymentsForAgreement,
  updateMissionPaymentStatus,
  getMissionPaymentByStripePaymentIntent,
  getPendingScheduledPayments,
  getMissionPaymentSummary,
} from "../services/missionPayment.service.js";
import { getMissionAgreementById } from "../services/missionAgreement.service.js";

/**
 * 🔹 POST /api/v1/mission-payments
 * Créer un paiement pour une mission
 */
export async function createMissionPaymentController(req, res) {
  try {
    const { missionAgreementId, type, amount, scheduledDate, installmentNumber, monthNumber } = req.body;

    if (!missionAgreementId || !type || !amount) {
      return res.status(400).json({ error: "Missing required fields: missionAgreementId, type, amount" });
    }

    // Vérifier les permissions (seule la company peut créer des paiements)
    const agreement = await getMissionAgreementById(missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    if (req.user.role !== "company" || agreement.companyId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const payment = await createMissionPayment({
      missionAgreementId,
      type,
      amount,
      scheduledDate,
      installmentNumber,
      monthNumber,
    });

    return res.status(201).json({ data: payment });
  } catch (err) {
    console.error("[MISSION PAYMENT] create error:", err);
    const statusCode = err.message?.includes("Invalid") ? 400 : 500;
    return res.status(statusCode).json({ error: err.message || "Could not create mission payment" });
  }
}

/**
 * 🔹 GET /api/v1/mission-payments/:id
 * Récupérer un paiement par ID
 */
export async function getMissionPaymentController(req, res) {
  try {
    const { id } = req.params;
    const payment = await getMissionPaymentById(id);

    if (!payment) {
      return res.status(404).json({ error: "Mission Payment not found" });
    }

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(payment.missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole === "company" && agreement.companyId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (userRole === "provider" && agreement.detailerId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json({ data: payment });
  } catch (err) {
    console.error("[MISSION PAYMENT] get error:", err);
    return res.status(500).json({ error: "Could not fetch mission payment" });
  }
}

/**
 * 🔹 GET /api/v1/mission-agreements/:id/payments
 * Récupérer tous les paiements d'une mission
 */
export async function listMissionPaymentsController(req, res) {
  try {
    const { id } = req.params; // missionAgreementId

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(id);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole === "company" && agreement.companyId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (userRole === "provider" && agreement.detailerId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const payments = await getMissionPaymentsForAgreement(id);

    return res.json({ data: payments });
  } catch (err) {
    console.error("[MISSION PAYMENT] list error:", err);
    return res.status(500).json({ error: "Could not fetch mission payments" });
  }
}

/**
 * 🔹 GET /api/v1/mission-agreements/:id/payments/summary
 * Récapitulatif des paiements d'une mission
 */
export async function getMissionPaymentSummaryController(req, res) {
  try {
    const { id } = req.params; // missionAgreementId

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(id);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole === "company" && agreement.companyId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (userRole === "provider" && agreement.detailerId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const summary = await getMissionPaymentSummary(id);

    return res.json({ data: summary });
  } catch (err) {
    console.error("[MISSION PAYMENT] summary error:", err);
    return res.status(500).json({ error: "Could not fetch mission payment summary" });
  }
}

/**
 * 🔹 PATCH /api/v1/mission-payments/:id/status
 * Mettre à jour le statut d'un paiement
 */
export async function updateMissionPaymentStatusController(req, res) {
  try {
    const { id } = req.params;
    const { status, stripePaymentIntentId, stripeChargeId, stripeRefundId, failureReason } = req.body;

    if (!status) {
      return res.status(400).json({ error: "Missing status" });
    }

    // Vérifier les permissions (seule la company peut mettre à jour le statut)
    const payment = await getMissionPaymentById(id);
    if (!payment) {
      return res.status(404).json({ error: "Mission Payment not found" });
    }

    const agreement = await getMissionAgreementById(payment.missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    if (req.user.role !== "company" || agreement.companyId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updated = await updateMissionPaymentStatus(id, status, {
      stripePaymentIntentId,
      stripeChargeId,
      stripeRefundId,
      failureReason,
    });

    return res.json({ data: updated });
  } catch (err) {
    console.error("[MISSION PAYMENT] update status error:", err);
    const statusCode = err.message?.includes("Invalid status") ? 400 : 500;
    return res.status(statusCode).json({ error: err.message || "Could not update mission payment status" });
  }
}

/**
 * 🔹 GET /api/v1/mission-payments/stripe/:paymentIntentId
 * Trouver un paiement par Stripe Payment Intent ID
 */
export async function getMissionPaymentByStripeController(req, res) {
  try {
    const { paymentIntentId } = req.params;

    const payment = await getMissionPaymentByStripePaymentIntent(paymentIntentId);

    if (!payment) {
      return res.status(404).json({ error: "Mission Payment not found" });
    }

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(payment.missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole === "company" && agreement.companyId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (userRole === "provider" && agreement.detailerId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json({ data: payment });
  } catch (err) {
    console.error("[MISSION PAYMENT] get by stripe error:", err);
    return res.status(500).json({ error: "Could not fetch mission payment" });
  }
}

/**
 * 🔹 GET /api/v1/mission-payments/pending-scheduled
 * Récupérer les paiements programmés à capturer aujourd'hui (admin/cron)
 */
export async function getPendingScheduledPaymentsController(req, res) {
  try {
    // Seulement pour admin ou cron jobs
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { date } = req.query; // Optionnel : date au format YYYY-MM-DD
    const payments = await getPendingScheduledPayments(date || null);

    return res.json({ data: payments });
  } catch (err) {
    console.error("[MISSION PAYMENT] pending scheduled error:", err);
    return res.status(500).json({ error: "Could not fetch pending scheduled payments" });
  }
}
