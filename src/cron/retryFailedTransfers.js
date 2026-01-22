// src/cron/retryFailedTransfers.js
import { retryAllPendingTransfers } from "../services/failedTransfer.service.js";

/**
 * 🟦 RETRY FAILED TRANSFERS – Retenter automatiquement les transferts échoués
 * 
 * Cette fonction est appelée par un cron job (ex: toutes les 6 heures) pour retenter
 * automatiquement les transferts Stripe qui ont échoué.
 * 
 * @param {number} limit - Nombre maximum de transferts à retenter (default: 10)
 * @returns {Promise<Object>} Résultat avec statistiques
 */
export async function retryFailedTransfers(limit = 10) {
  console.log(`🔄 [CRON] Starting retry of failed transfers (limit: ${limit})`);

  try {
    const result = await retryAllPendingTransfers(limit);

    console.log(`✅ [CRON] Retry completed: ${result.succeeded} succeeded, ${result.failed} failed out of ${result.total} total`);

    return result;
  } catch (err) {
    console.error("❌ [CRON] Error retrying failed transfers:", err);
    throw err;
  }
}
