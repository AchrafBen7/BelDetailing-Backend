// src/services/failedTransfer.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { createTransferToDetailer } from "./missionPayout.service.js";
import { notifyAdmin, logCriticalError } from "./adminNotification.service.js";
import { sendNotificationWithDeepLink } from "./onesignal.service.js";
import { logger } from "../observability/logger.js";
import { failedTransfersTotal } from "../observability/metrics.js";

/**
 * 🟦 RECORD FAILED TRANSFER – Enregistrer un échec de transfert dans la table failed_transfers
 * 
 * @param {Object} params
 * @param {string} params.missionAgreementId - ID du Mission Agreement
 * @param {string} params.paymentId - ID du paiement
 * @param {string} params.detailerId - ID du detailer
 * @param {string} params.stripeConnectedAccountId - ID du compte Stripe Connect
 * @param {number} params.amount - Montant à transférer
 * @param {number} params.commissionRate - Taux de commission
 * @param {Error} params.error - L'erreur qui a causé l'échec
 * @returns {Promise<Object>} Enregistrement créé
 */
export async function recordFailedTransfer({
  missionAgreementId,
  paymentId,
  detailerId,
  stripeConnectedAccountId,
  amount,
  commissionRate,
  error,
}) {
  const commissionAmount = Math.round(amount * commissionRate * 100) / 100;
  const netAmount = Math.round((amount - commissionAmount) * 100) / 100;

  const { data, error: insertError } = await supabase
    .from("failed_transfers")
    .insert({
      mission_agreement_id: missionAgreementId,
      mission_payment_id: paymentId,
      detailer_id: detailerId,
      stripe_connected_account_id: stripeConnectedAccountId,
      amount,
      commission_rate: commissionRate,
      commission_amount: commissionAmount,
      net_amount: netAmount,
      error_message: error.message,
      error_code: error.code || error.type || null,
      status: "pending",
      retry_count: 0,
      max_retries: 3,
    })
    .select("*")
    .single();

  if (insertError) {
    console.error("[FAILED TRANSFER] Error recording failed transfer:", insertError);
    throw insertError;
  }

  logger.warn({ failedTransferId: data.id, paymentId, missionAgreementId, detailerId, amount, error: error.message }, "[FAILED TRANSFER] Recorded failed transfer");
  
  // ✅ MÉTRIQUE : Incrémenter le compteur de transferts échoués
  failedTransfersTotal.inc({ retry_count: "0" });

  return data;
}

/**
 * 🟦 GET PENDING FAILED TRANSFERS – Récupérer les transferts échoués en attente de retry
 * 
 * @param {number} limit - Nombre maximum de transferts à récupérer (default: 10)
 * @returns {Promise<Array>} Liste des transferts en attente
 */
export async function getPendingFailedTransfers(limit = 10) {
  const { data, error } = await supabase
    .from("failed_transfers")
    .select("*")
    .in("status", ["pending", "retrying"])
    .lt("retry_count", supabase.raw("max_retries"))
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;

  return data || [];
}

/**
 * 🟦 RETRY FAILED TRANSFER – Retenter un transfert échoué
 * 
 * @param {string} failedTransferId - ID de l'enregistrement failed_transfer
 * @returns {Promise<Object>} Résultat du retry (success: true/false)
 */
export async function retryFailedTransfer(failedTransferId) {
  // 1) Récupérer l'enregistrement
  const { data: failedTransfer, error: fetchError } = await supabase
    .from("failed_transfers")
    .select("*")
    .eq("id", failedTransferId)
    .single();

  if (fetchError || !failedTransfer) {
    throw new Error("Failed transfer not found");
  }

  // 2) Vérifier qu'on peut encore retenter
  if (failedTransfer.retry_count >= failedTransfer.max_retries) {
    // Marquer comme échec définitif
    await supabase
      .from("failed_transfers")
      .update({
        status: "failed_permanently",
        updated_at: new Date().toISOString(),
      })
      .eq("id", failedTransferId);

    throw new Error(`Max retries (${failedTransfer.max_retries}) reached for transfer ${failedTransferId}`);
  }

  // 3) Mettre à jour le statut en "retrying"
  await supabase
    .from("failed_transfers")
    .update({
      status: "retrying",
      retry_count: failedTransfer.retry_count + 1,
      last_retry_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", failedTransferId);

  // 4) Retenter le transfert
  try {
    const transfer = await createTransferToDetailer({
      missionAgreementId: failedTransfer.mission_agreement_id,
      paymentId: failedTransfer.mission_payment_id,
      amount: failedTransfer.amount,
      commissionRate: failedTransfer.commission_rate,
    });

    // ✅ SUCCÈS : Marquer comme réussi
    await supabase
      .from("failed_transfers")
      .update({
        status: "succeeded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", failedTransferId);

    logger.info({ failedTransferId, transferId: transfer.id, paymentId: failedTransfer.mission_payment_id, retryCount: failedTransfer.retry_count + 1 }, "[FAILED TRANSFER] Retry succeeded");

    // ✅ NOTIFIER LE DETAILER (transfert réussi après retry)
    try {
      await sendNotificationWithDeepLink({
        userId: failedTransfer.detailer_id,
        title: "Virement reçu",
        message: `Le virement de ${failedTransfer.net_amount.toFixed(2)}€ a été effectué avec succès.`,
        type: "mission_payment_received",
        id: failedTransfer.mission_agreement_id,
      });
    } catch (notifError) {
      console.error("[FAILED TRANSFER] Notification send failed:", notifError);
    }

    return {
      success: true,
      transferId: transfer.id,
      failedTransferId,
    };
  } catch (err) {
    // ❌ ÉCHEC : Mettre à jour avec la nouvelle erreur
    await supabase
      .from("failed_transfers")
      .update({
        error_message: err.message,
        error_code: err.code || err.type || null,
        status: failedTransfer.retry_count + 1 >= failedTransfer.max_retries ? "failed_permanently" : "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", failedTransferId);

    console.error(`❌ [FAILED TRANSFER] Retry failed for transfer ${failedTransferId}:`, err);

    // ✅ NOTIFIER L'ADMIN si c'est le dernier retry
    if (failedTransfer.retry_count + 1 >= failedTransfer.max_retries) {
      try {
        await notifyAdmin({
          title: "Échec définitif de transfert",
          message: `Le transfert de ${failedTransfer.net_amount.toFixed(2)}€ pour le paiement ${failedTransfer.mission_payment_id} a échoué après ${failedTransfer.max_retries} tentatives. Intervention manuelle requise.`,
          type: "transfer_failed_permanently",
          context: {
            failedTransferId,
            missionAgreementId: failedTransfer.mission_agreement_id,
            paymentId: failedTransfer.mission_payment_id,
            detailerId: failedTransfer.detailer_id,
            amount: failedTransfer.net_amount,
            retryCount: failedTransfer.retry_count + 1,
            error: err.message,
          },
        });
      } catch (notifError) {
        console.error("[FAILED TRANSFER] Admin notification failed:", notifError);
      }
    }

    return {
      success: false,
      error: err.message,
      failedTransferId,
      retryCount: failedTransfer.retry_count + 1,
    };
  }
}

/**
 * 🟦 RETRY ALL PENDING TRANSFERS – Retenter tous les transferts en attente
 * 
 * Cette fonction est appelée par un cron job pour retenter automatiquement
 * les transferts échoués.
 * 
 * @param {number} limit - Nombre maximum de transferts à retenter (default: 10)
 * @returns {Promise<Object>} Résultat avec statistiques
 */
export async function retryAllPendingTransfers(limit = 10) {
  console.log(`🔄 [FAILED TRANSFER] Starting retry of pending transfers (limit: ${limit})`);

  const pendingTransfers = await getPendingFailedTransfers(limit);

  if (pendingTransfers.length === 0) {
    console.log("ℹ️ [FAILED TRANSFER] No pending transfers to retry");
    return {
      success: true,
      total: 0,
      succeeded: 0,
      failed: 0,
      results: [],
    };
  }

  console.log(`📋 [FAILED TRANSFER] Found ${pendingTransfers.length} pending transfer(s) to retry`);

  const results = {
    success: true,
    total: pendingTransfers.length,
    succeeded: 0,
    failed: 0,
    results: [],
  };

  // Retenter chaque transfert
  for (const failedTransfer of pendingTransfers) {
    try {
      const result = await retryFailedTransfer(failedTransfer.id);

      if (result.success) {
        results.succeeded++;
      } else {
        results.failed++;
      }

      results.results.push({
        id: failedTransfer.id,
        paymentId: failedTransfer.mission_payment_id,
        success: result.success,
        error: result.error || null,
      });
    } catch (err) {
      console.error(`❌ [FAILED TRANSFER] Error retrying transfer ${failedTransfer.id}:`, err);
      results.failed++;
      results.results.push({
        id: failedTransfer.id,
        paymentId: failedTransfer.mission_payment_id,
        success: false,
        error: err.message,
      });
    }
  }

  console.log(`✅ [FAILED TRANSFER] Retry completed: ${results.succeeded} succeeded, ${results.failed} failed`);

  return results;
}
