import { Router } from "express";
import { timingSafeEqual } from "crypto";
import { cleanupExpiredBookings } from "../services/booking.service.js";
import { captureScheduledPayments } from "../cron/captureScheduledPayments.js";
import { retryFailedTransfers } from "../cron/retryFailedTransfers.js";
import { captureDayOnePaymentsCron } from "../cron/captureDayOnePayments.js";

const router = Router();

// 🔒 SECURITY: Timing-safe secret comparison to prevent timing attacks
function verifyCronSecret(provided) {
  const expected = process.env.CRON_SECRET;
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

router.post("/cleanup-bookings", async (req, res) => {
  const cronSecret = req.headers["x-cron-secret"];

  if (!verifyCronSecret(cronSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const deletedCount = await cleanupExpiredBookings();
    return res.json({
      success: true,
      deleted_count: deletedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[CRON] cleanup error:", err);
    return res.status(500).json({ error: "Cleanup failed" });
  }
});

/**
 * 🔹 POST /api/v1/cron/capture-scheduled-payments
 * Capturer automatiquement les paiements programmés à leur date d'échéance
 * 
 * Ce endpoint doit être appelé par un cron job (ex: toutes les heures) pour
 * capturer les paiements de mission qui sont autorisés et dont la date d'échéance est arrivée.
 * 
 * Query params:
 * - date (optionnel): Date au format YYYY-MM-DD (défaut: aujourd'hui)
 */
router.post("/capture-scheduled-payments", async (req, res) => {
  const cronSecret = req.headers["x-cron-secret"];

  if (!verifyCronSecret(cronSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { date } = req.query; // Optionnel: date au format YYYY-MM-DD
    const result = await captureScheduledPayments(date || null);

    return res.json({
      success: result.success,
      captured: result.captured,
      failed: result.failed,
      skipped: result.skipped,
      payments: result.payments,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[CRON] capture scheduled payments error:", err);
    return res.status(500).json({ error: "Capture scheduled payments failed" });
  }
});

/**
 * 🔹 POST /api/v1/cron/retry-failed-transfers
 * Retenter automatiquement les transferts échoués
 * 
 * Ce endpoint doit être appelé par un cron job (ex: toutes les 6 heures) pour
 * retenter automatiquement les transferts Stripe qui ont échoué.
 * 
 * Query params:
 * - limit (optionnel): Nombre maximum de transferts à retenter (défaut: 10)
 */
router.post("/retry-failed-transfers", async (req, res) => {
  const cronSecret = req.headers["x-cron-secret"];

  if (!verifyCronSecret(cronSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
    const result = await retryFailedTransfers(limit);

    return res.json({
      success: result.success,
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
      results: result.results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[CRON] retry failed transfers error:", err);
    return res.status(500).json({ error: "Retry failed transfers failed" });
  }
});

/**
 * 🔹 POST /api/v1/cron/capture-day-one-payments
 * Capturer automatiquement les paiements du jour 1 (commission NIOS + acompte detailer)
 * 
 * Ce endpoint doit être appelé par un cron job (ex: toutes les heures) pour
 * capturer les paiements du jour 1 pour les missions dont le startDate est aujourd'hui.
 * 
 * Query params:
 * - date (optionnel): Date au format YYYY-MM-DD (défaut: aujourd'hui)
 */
router.post("/capture-day-one-payments", async (req, res) => {
  const cronSecret = req.headers["x-cron-secret"];

  if (!verifyCronSecret(cronSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { date } = req.query; // Optionnel: date au format YYYY-MM-DD
    const result = await captureDayOnePaymentsCron(date || null);

    return res.json({
      success: result.success,
      captured: result.captured,
      failed: result.failed,
      skipped: result.skipped,
      missions: result.missions,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[CRON] capture day one payments error:", err);
    return res.status(500).json({ error: "Capture day one payments failed" });
  }
});

export default router;
