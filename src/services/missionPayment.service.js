// src/services/missionPayment.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { logger } from "../observability/logger.js";
import { missionPaymentsTotal, missionPaymentsAmount } from "../observability/metrics.js";

/**
 * DB → DTO (iOS Mission Payment)
 */
function mapMissionPaymentRowToDto(row) {
  if (!row) return null;

  return {
    id: row.id,
    missionAgreementId: row.mission_agreement_id,
    type: row.type, // deposit, installment, final, monthly
    amount: row.amount ? Number(row.amount) : null,
    status: row.status, // pending, authorized, captured, failed, refunded, cancelled
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeChargeId: row.stripe_charge_id,
    stripeRefundId: row.stripe_refund_id,
    scheduledDate: row.scheduled_date,
    authorizedAt: row.authorized_at,
    capturedAt: row.captured_at,
    failedAt: row.failed_at,
    installmentNumber: row.installment_number,
    monthNumber: row.month_number,
    failureReason: row.failure_reason,
    invoicePdfUrl: row.invoice_pdf_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 🟦 CREATE – Créer un paiement pour une mission
 * 
 * @param {Object} params
 * @param {string} params.missionAgreementId - ID du Mission Agreement
 * @param {string} params.type - Type de paiement (deposit, installment, final, monthly)
 * @param {number} params.amount - Montant
 * @param {Date} params.scheduledDate - Date prévue de capture (optionnel)
 * @param {number} params.installmentNumber - Numéro d'échéance (pour installments)
 * @param {number} params.monthNumber - Numéro de mois (pour monthly)
 */
export async function createMissionPayment({
  missionAgreementId,
  type,
  amount,
  scheduledDate = null,
  installmentNumber = null,
  monthNumber = null,
}) {
  // ✅ VALIDATION : missionAgreementId doit être fourni
  if (!missionAgreementId) {
    throw new Error("missionAgreementId is required");
  }

  // ✅ VALIDATION : amount doit être > 0
  if (!amount || amount <= 0) {
    throw new Error("amount must be greater than 0");
  }

  // ✅ VALIDATION : type doit être valide
  const validTypes = ["deposit", "commission", "installment", "final", "monthly"];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid payment type. Must be one of: ${validTypes.join(", ")}`);
  }

  const insertPayload = {
    mission_agreement_id: missionAgreementId,
    type,
    amount,
    status: "pending",
    scheduled_date: scheduledDate,
    installment_number: installmentNumber,
    month_number: monthNumber,
  };

  const { data, error } = await supabase
    .from("mission_payments")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    logger.error({ error, missionAgreementId, type, amount }, "[MISSION PAYMENT] Insert error");
    throw error;
  }

  logger.info({ paymentId: data.id, missionAgreementId, type, amount, status: data.status }, "[MISSION PAYMENT] Created");
  
  // ✅ MÉTRIQUES : Incrémenter les compteurs
  missionPaymentsTotal.inc({ type, status: data.status });
  missionPaymentsAmount.inc({ type, status: data.status }, amount);

  return mapMissionPaymentRowToDto(data);
}

/**
 * 🟦 GET BY ID – Récupérer un paiement par ID
 */
export async function getMissionPaymentById(id) {
  const { data, error } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    throw error;
  }

  return mapMissionPaymentRowToDto(data);
}

/**
 * 🟦 GET FOR MISSION – Récupérer tous les paiements d'une mission
 */
export async function getMissionPaymentsForAgreement(missionAgreementId) {
  const { data, error } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("mission_agreement_id", missionAgreementId)
    .order("scheduled_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  return data.map(mapMissionPaymentRowToDto);
}

/**
 * 🟦 UPDATE STATUS – Mettre à jour le statut d'un paiement
 */
export async function updateMissionPaymentStatus(id, newStatus, additionalData = {}) {
  // ✅ SEPA ASYNCHRONE : Ajouter "processing" et "succeeded" pour SEPA Direct Debit
  const validStatuses = ["pending", "authorized", "processing", "succeeded", "captured", "captured_held", "transferred", "failed", "refunded", "cancelled"];
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
  }

  const updatePayload = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  // Mettre à jour les dates selon le statut
  if (newStatus === "authorized" && !additionalData.authorizedAt) {
    updatePayload.authorized_at = new Date().toISOString();
  } else if (additionalData.authorizedAt) {
    updatePayload.authorized_at = additionalData.authorizedAt;
  }

  // ✅ SEPA : "succeeded" est équivalent à "captured" pour SEPA (argent reçu)
  if ((newStatus === "captured" || newStatus === "succeeded") && !additionalData.capturedAt) {
    updatePayload.captured_at = new Date().toISOString();
  } else if (additionalData.capturedAt) {
    updatePayload.captured_at = additionalData.capturedAt;
  }

  if (newStatus === "failed" && !additionalData.failedAt) {
    updatePayload.failed_at = new Date().toISOString();
  } else if (additionalData.failedAt) {
    updatePayload.failed_at = additionalData.failedAt;
  }

  // Mettre à jour les IDs Stripe si fournis
  if (additionalData.stripePaymentIntentId) {
    updatePayload.stripe_payment_intent_id = additionalData.stripePaymentIntentId;
  }
  if (additionalData.stripeChargeId) {
    updatePayload.stripe_charge_id = additionalData.stripeChargeId;
  }
  if (additionalData.stripeRefundId) {
    updatePayload.stripe_refund_id = additionalData.stripeRefundId;
  }
  if (additionalData.stripeTransferId) {
    updatePayload.stripe_transfer_id = additionalData.stripeTransferId;
  }
  if (additionalData.transferredAt) {
    updatePayload.transferred_at = additionalData.transferredAt;
  }
  if (additionalData.holdUntil) {
    updatePayload.hold_until = additionalData.holdUntil;
  }
  if (additionalData.failureReason) {
    updatePayload.failure_reason = additionalData.failureReason;
  }

  const { data, error } = await supabase
    .from("mission_payments")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return mapMissionPaymentRowToDto(data);
}

/**
 * 🟦 GET BY STRIPE PAYMENT INTENT – Trouver un paiement par Payment Intent ID
 */
export async function getMissionPaymentByStripePaymentIntent(paymentIntentId) {
  const { data, error } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (error) throw error;

  return data ? mapMissionPaymentRowToDto(data) : null;
}

/**
 * 🟦 GET PENDING SCHEDULED – Récupérer les paiements programmés à capturer aujourd'hui
 */
export async function getPendingScheduledPayments(date = null) {
  const targetDate = date || new Date().toISOString().split("T")[0]; // Format YYYY-MM-DD

  const { data, error } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("status", "authorized")
    .eq("scheduled_date", targetDate);

  if (error) throw error;

  return data.map(mapMissionPaymentRowToDto);
}

/**
 * 🟦 GET SUMMARY – Récapitulatif des paiements d'une mission
 */
export async function getMissionPaymentSummary(missionAgreementId) {
  const { data, error } = await supabase
    .from("mission_payments")
    .select("*")
    .eq("mission_agreement_id", missionAgreementId);

  if (error) throw error;

  const payments = data.map(mapMissionPaymentRowToDto);

  const summary = {
    total: payments.length,
    byStatus: {
      pending: payments.filter((p) => p.status === "pending").length,
      authorized: payments.filter((p) => p.status === "authorized").length,
      captured: payments.filter((p) => p.status === "captured").length,
      failed: payments.filter((p) => p.status === "failed").length,
      refunded: payments.filter((p) => p.status === "refunded").length,
    },
    byType: {
      deposit: payments.filter((p) => p.type === "deposit").length,
      installment: payments.filter((p) => p.type === "installment").length,
      final: payments.filter((p) => p.type === "final").length,
      monthly: payments.filter((p) => p.type === "monthly").length,
    },
    totalCaptured: payments
      .filter((p) => p.status === "captured")
      .reduce((sum, p) => sum + (p.amount || 0), 0),
    totalPending: payments
      .filter((p) => p.status === "pending" || p.status === "authorized")
      .reduce((sum, p) => sum + (p.amount || 0), 0),
  };

  return summary;
}
