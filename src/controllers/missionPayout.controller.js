// src/controllers/missionPayout.controller.js
import {
  createTransferToDetailer,
  getPayoutSummaryForDetailer,
  checkConnectedAccountStatus,
} from "../services/missionPayout.service.js";
import { getMissionAgreementById } from "../services/missionAgreement.service.js";
import { getMissionPaymentById } from "../services/missionPayment.service.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";

/**
 * 🔹 POST /api/v1/mission-payouts/transfer
 * Créer un transfert manuel vers un detailer (admin ou company)
 */
export async function createTransferController(req, res) {
  try {
    const { missionAgreementId, paymentId, amount, commissionRate } = req.body;

    if (!missionAgreementId || !paymentId || !amount) {
      return res.status(400).json({ error: "Missing required fields: missionAgreementId, paymentId, amount" });
    }

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userRole = req.user.role;
    const userId = req.user.id;

    // Seule la company propriétaire ou un admin peut créer un transfert
    if (userRole !== "admin" && (userRole !== "company" || agreement.companyId !== userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Vérifier que le paiement existe et est capturé
    const payment = await getMissionPaymentById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    if (payment.status !== "captured") {
      return res.status(400).json({ error: `Payment is not captured. Current status: ${payment.status}` });
    }

    const transfer = await createTransferToDetailer({
      missionAgreementId,
      paymentId,
      amount,
      commissionRate: commissionRate || MISSION_COMMISSION_RATE, // 7% pour les missions
    });

    return res.status(201).json({ data: transfer });
  } catch (err) {
    console.error("[MISSION PAYOUT] create transfer error:", err);
    return res.status(400).json({ error: err.message || "Could not create transfer" });
  }
}

/**
 * 🔹 GET /api/v1/mission-payouts/summary
 * Récupérer le récapitulatif des payouts pour le detailer connecté
 */
export async function getPayoutSummaryController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can view payout summary" });
    }

    const { missionAgreementId } = req.query; // Optionnel

    const summary = await getPayoutSummaryForDetailer(req.user.id, missionAgreementId || null);

    return res.json({ data: summary });
  } catch (err) {
    console.error("[MISSION PAYOUT] summary error:", err);
    return res.status(400).json({ error: err.message || "Could not fetch payout summary" });
  }
}

/**
 * 🔹 GET /api/v1/mission-payouts/account-status
 * Vérifier le statut du compte Stripe Connect du detailer
 */
export async function getConnectedAccountStatusController(req, res) {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can view account status" });
    }

    const status = await checkConnectedAccountStatus(req.user.id);

    return res.json({ data: status });
  } catch (err) {
    console.error("[MISSION PAYOUT] account status error:", err);
    return res.status(400).json({ error: err.message || "Could not fetch account status" });
  }
}
