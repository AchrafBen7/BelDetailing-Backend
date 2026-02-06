// src/services/missionConfirmation.service.js
/**
 * 🟦 MISSION CONFIRMATION SERVICE
 * 
 * Gère la confirmation mutuelle de démarrage et de fin de mission.
 * Les deux parties (company + detailer) doivent confirmer pour déclencher
 * les actions (paiements J1, fin de mission).
 * 
 * Sécurité :
 * - Vérification ownership (company_id / detailer_id)
 * - State machine stricte (transitions validées)
 * - Idempotence (double confirmation = no-op)
 * - Audit log de chaque action
 * - Anti-fraude : délais de confirmation (timeout)
 */

import { supabaseAdmin as supabase } from "../config/supabase.js";
import { getMissionAgreementById, mapMissionAgreementRowToDto } from "./missionAgreement.service.js";
import { validateTransition, canPerformAction } from "./missionStateMachine.service.js";
import { logger } from "../observability/logger.js";

// ============================================================
// HELPERS
// ============================================================

async function logConfirmationAction(agreementId, action, actorId, actorRole, prevStatus, newStatus, metadata = {}) {
  try {
    await supabase.from("mission_confirmation_logs").insert({
      mission_agreement_id: agreementId,
      action,
      actor_id: actorId,
      actor_role: actorRole,
      previous_status: prevStatus,
      new_status: newStatus,
      metadata,
    });
  } catch (err) {
    console.error("[MISSION CONFIRMATION] Failed to log action:", err);
  }
}

async function sendMissionNotification(userId, title, message, type, agreementId) {
  try {
    const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
    await sendNotificationWithDeepLink({
      userId,
      title,
      message,
      type,
      id: agreementId,
    });
  } catch (err) {
    console.error("[MISSION CONFIRMATION] Notification failed:", err);
  }
}

function assertOwnership(agreement, userId, role) {
  if (role === "company" && agreement.companyId !== userId) {
    const err = new Error("Forbidden: You are not the company for this mission");
    err.statusCode = 403;
    throw err;
  }
  if (role === "provider" && agreement.detailerId !== userId) {
    const err = new Error("Forbidden: You are not the detailer for this mission");
    err.statusCode = 403;
    throw err;
  }
}

// ============================================================
// 1. CONFIRM MISSION START (Mutual)
// ============================================================

/**
 * Company ou detailer confirme le démarrage de la mission.
 * Quand les deux ont confirmé → déclenche les paiements J1 → status = "active"
 * 
 * @param {string} missionAgreementId
 * @param {string} userId
 * @param {string} role - "company" | "provider"
 * @returns {Promise<Object>} Updated agreement + start confirmation status
 */
export async function confirmMissionStart(missionAgreementId, userId, role) {
  // 1) Fetch agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    const err = new Error("Mission Agreement not found");
    err.statusCode = 404;
    throw err;
  }

  // 2) Ownership check
  assertOwnership(agreement, userId, role);

  // 3) Status check: must be payment_scheduled or awaiting_start
  if (agreement.status !== "payment_scheduled" && agreement.status !== "awaiting_start") {
    const err = new Error(
      `Cannot confirm start. Current status: ${agreement.status}. ` +
      `Expected: payment_scheduled or awaiting_start`
    );
    err.statusCode = 400;
    throw err;
  }

  // 4) Date check: can only confirm on or after start date
  if (agreement.startDate) {
    const startDate = new Date(agreement.startDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    startDate.setHours(0, 0, 0, 0);
    
    // Allow confirmation from 1 day before start date
    const oneDayBefore = new Date(startDate);
    oneDayBefore.setDate(oneDayBefore.getDate() - 1);
    
    if (today < oneDayBefore) {
      const err = new Error(
        `Cannot confirm start before ${startDate.toISOString().split("T")[0]}. ` +
        `You can confirm from the day before the start date.`
      );
      err.statusCode = 400;
      throw err;
    }
  }

  // 5) Idempotence: check if already confirmed by this role
  const confirmField = role === "company" ? "company_confirmed_start_at" : "detailer_confirmed_start_at";
  
  const { data: current } = await supabase
    .from("mission_agreements")
    .select("company_confirmed_start_at, detailer_confirmed_start_at, status")
    .eq("id", missionAgreementId)
    .single();

  if (!current) {
    const err = new Error("Mission Agreement not found in DB");
    err.statusCode = 404;
    throw err;
  }

  const alreadyConfirmedByMe = role === "company"
    ? current.company_confirmed_start_at
    : current.detailer_confirmed_start_at;

  if (alreadyConfirmedByMe) {
    // Already confirmed by this party - return current state
    const otherConfirmed = role === "company"
      ? current.detailer_confirmed_start_at
      : current.company_confirmed_start_at;

    return {
      alreadyConfirmed: true,
      bothConfirmed: !!otherConfirmed,
      status: current.status,
    };
  }

  // 6) Record confirmation
  const now = new Date().toISOString();
  const updatePayload = {
    [confirmField]: now,
    updated_at: now,
  };

  // 7) Check if the other party already confirmed
  const otherField = role === "company" ? "detailer_confirmed_start_at" : "company_confirmed_start_at";
  const otherConfirmed = current[otherField];

  let newStatus;
  let triggerDayOnePayments = false;

  if (otherConfirmed) {
    // Both confirmed! → Transition to active + trigger Day 1 payments
    validateTransition(current.status, "active");
    updatePayload.status = "active";
    newStatus = "active";
    triggerDayOnePayments = true;
  } else {
    // Only one confirmed → Transition to awaiting_start
    if (current.status === "payment_scheduled") {
      validateTransition("payment_scheduled", "awaiting_start");
      updatePayload.status = "awaiting_start";
      newStatus = "awaiting_start";
    } else {
      // Already awaiting_start, just record the confirmation
      newStatus = "awaiting_start";
    }
  }

  // 8) Update DB
  const { data: updated, error: updateError } = await supabase
    .from("mission_agreements")
    .update(updatePayload)
    .eq("id", missionAgreementId)
    .select("*")
    .single();

  if (updateError) throw updateError;

  // 9) Audit log
  await logConfirmationAction(
    missionAgreementId,
    "confirm_start",
    userId,
    role,
    current.status,
    newStatus,
    { triggerDayOnePayments }
  );

  // 10) Notifications
  const otherPartyId = role === "company" ? agreement.detailerId : agreement.companyId;
  const actorLabel = role === "company" ? "La company" : "Le detailer";

  if (triggerDayOnePayments) {
    // Both confirmed - notify both
    await sendMissionNotification(
      agreement.companyId,
      "Mission demarrée",
      `La mission "${agreement.title || ""}" a officiellement démarré. Les paiements du jour 1 sont en cours.`,
      "mission_started",
      missionAgreementId
    );
    await sendMissionNotification(
      agreement.detailerId,
      "Mission demarrée",
      `La mission "${agreement.title || ""}" a officiellement démarré. Votre acompte sera versé sous 24-48h.`,
      "mission_started",
      missionAgreementId
    );
  } else {
    // Only one confirmed - notify the other
    await sendMissionNotification(
      otherPartyId,
      "Confirmation de démarrage requise",
      `${actorLabel} a confirmé le démarrage de la mission "${agreement.title || ""}". Veuillez confirmer à votre tour.`,
      "mission_start_confirmation_needed",
      missionAgreementId
    );
  }

  // 11) Trigger Day 1 payments if both confirmed
  let paymentResult = null;
  if (triggerDayOnePayments) {
    try {
      const { createDayOnePayments, captureDayOnePayments } = await import("./missionPaymentDayOne.service.js");
      
      console.log(`[MISSION CONFIRMATION] Both parties confirmed start for ${missionAgreementId}. Triggering Day 1 payments...`);
      
      const createResult = await createDayOnePayments(missionAgreementId);
      
      if (!createResult.alreadyCreated) {
        paymentResult = await captureDayOnePayments(missionAgreementId);
        console.log(`[MISSION CONFIRMATION] Day 1 payments captured: ${JSON.stringify(paymentResult)}`);
      } else {
        console.log(`[MISSION CONFIRMATION] Day 1 payments already exist for ${missionAgreementId}`);
        paymentResult = createResult;
      }
    } catch (paymentError) {
      console.error(`[MISSION CONFIRMATION] Day 1 payment error:`, paymentError);
      // Don't fail the confirmation - the payment can be retried
      paymentResult = { error: paymentError.message };
    }
  }

  return {
    agreement: mapMissionAgreementRowToDto(updated),
    confirmationStatus: {
      companyConfirmed: !!updated.company_confirmed_start_at,
      detailerConfirmed: !!updated.detailer_confirmed_start_at,
      bothConfirmed: triggerDayOnePayments,
    },
    paymentResult,
    newStatus,
  };
}

// ============================================================
// 2. CONFIRM MISSION END (Mutual)
// ============================================================

/**
 * Company ou detailer confirme la fin de la mission.
 * Quand les deux ont confirmé → déclenche le paiement final → status = "completed"
 * 
 * @param {string} missionAgreementId
 * @param {string} userId
 * @param {string} role - "company" | "provider"
 * @returns {Promise<Object>} Updated agreement + end confirmation status
 */
export async function confirmMissionEnd(missionAgreementId, userId, role) {
  // 1) Fetch agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    const err = new Error("Mission Agreement not found");
    err.statusCode = 404;
    throw err;
  }

  // 2) Ownership check
  assertOwnership(agreement, userId, role);

  // 3) Status check: must be active or awaiting_end
  if (agreement.status !== "active" && agreement.status !== "awaiting_end") {
    const err = new Error(
      `Cannot confirm end. Current status: ${agreement.status}. ` +
      `Expected: active or awaiting_end`
    );
    err.statusCode = 400;
    throw err;
  }

  // 4) Verify mission has been started (both start confirmations exist)
  const { data: current } = await supabase
    .from("mission_agreements")
    .select("company_confirmed_start_at, detailer_confirmed_start_at, company_confirmed_end_at, detailer_confirmed_end_at, status")
    .eq("id", missionAgreementId)
    .single();

  if (!current) {
    const err = new Error("Mission Agreement not found in DB");
    err.statusCode = 404;
    throw err;
  }

  if (!current.company_confirmed_start_at || !current.detailer_confirmed_start_at) {
    const err = new Error("Mission has not been started by both parties yet");
    err.statusCode = 400;
    throw err;
  }

  // 5) Idempotence
  const confirmField = role === "company" ? "company_confirmed_end_at" : "detailer_confirmed_end_at";
  const alreadyConfirmedByMe = role === "company"
    ? current.company_confirmed_end_at
    : current.detailer_confirmed_end_at;

  if (alreadyConfirmedByMe) {
    const otherConfirmed = role === "company"
      ? current.detailer_confirmed_end_at
      : current.company_confirmed_end_at;

    return {
      alreadyConfirmed: true,
      bothConfirmed: !!otherConfirmed,
      status: current.status,
    };
  }

  // 6) Record confirmation
  const now = new Date().toISOString();
  const updatePayload = {
    [confirmField]: now,
    updated_at: now,
  };

  // 7) Check if the other party already confirmed
  const otherField = role === "company" ? "detailer_confirmed_end_at" : "company_confirmed_end_at";
  const otherConfirmed = current[otherField];

  let newStatus;
  let triggerFinalPayment = false;

  if (otherConfirmed) {
    // Both confirmed! → Transition to completed + trigger final payment
    validateTransition(current.status, "completed");
    updatePayload.status = "completed";
    newStatus = "completed";
    triggerFinalPayment = true;
  } else {
    // Only one confirmed → Transition to awaiting_end
    if (current.status === "active") {
      validateTransition("active", "awaiting_end");
      updatePayload.status = "awaiting_end";
      newStatus = "awaiting_end";
    } else {
      newStatus = "awaiting_end";
    }
  }

  // 8) Update DB
  const { data: updated, error: updateError } = await supabase
    .from("mission_agreements")
    .update(updatePayload)
    .eq("id", missionAgreementId)
    .select("*")
    .single();

  if (updateError) throw updateError;

  // 9) Audit log
  await logConfirmationAction(
    missionAgreementId,
    "confirm_end",
    userId,
    role,
    current.status,
    newStatus,
    { triggerFinalPayment }
  );

  // 10) Notifications
  const otherPartyId = role === "company" ? agreement.detailerId : agreement.companyId;
  const actorLabel = role === "company" ? "La company" : "Le detailer";

  if (triggerFinalPayment) {
    await sendMissionNotification(
      agreement.companyId,
      "Mission terminée",
      `La mission "${agreement.title || ""}" est officiellement terminée. Le paiement final est en cours de traitement.`,
      "mission_completed",
      missionAgreementId
    );
    await sendMissionNotification(
      agreement.detailerId,
      "Mission terminée",
      `La mission "${agreement.title || ""}" est officiellement terminée. Votre paiement final sera versé sous 2-5 jours.`,
      "mission_completed",
      missionAgreementId
    );
  } else {
    await sendMissionNotification(
      otherPartyId,
      "Confirmation de fin requise",
      `${actorLabel} a confirmé la fin de la mission "${agreement.title || ""}". Veuillez confirmer à votre tour.`,
      "mission_end_confirmation_needed",
      missionAgreementId
    );
  }

  // 11) Trigger final payment if both confirmed
  let paymentResult = null;
  if (triggerFinalPayment) {
    try {
      const { getMissionPaymentsForAgreement, updateMissionPaymentStatus } = await import("./missionPayment.service.js");
      const payments = await getMissionPaymentsForAgreement(missionAgreementId);
      
      // Find the "final" payment
      const finalPayment = payments.find(p => p.type === "final" && (p.status === "pending" || p.status === "authorized"));
      
      if (finalPayment) {
        console.log(`[MISSION CONFIRMATION] Triggering final payment (${finalPayment.amount}EUR) for ${missionAgreementId}`);
        
        // Create SEPA PaymentIntent for the final payment
        const { createSepaPaymentIntent } = await import("./sepaDirectDebit.service.js");
        
        const paymentIntent = await createSepaPaymentIntent({
          companyUserId: agreement.companyId,
          amount: finalPayment.amount,
          currency: "eur",
          paymentMethodId: null,
          applicationFeeAmount: 0,
          captureMethod: "automatic",
          metadata: {
            missionAgreementId: agreement.id,
            paymentId: finalPayment.id,
            type: "mission_final",
            paymentType: "final",
            userId: agreement.companyId,
          },
        });

        const status = paymentIntent.status === "succeeded" ? "captured" :
                       paymentIntent.status === "processing" ? "processing" : "authorized";

        await updateMissionPaymentStatus(finalPayment.id, status, {
          stripePaymentIntentId: paymentIntent.id,
          capturedAt: status === "captured" ? now : null,
        });

        paymentResult = {
          paymentId: finalPayment.id,
          amount: finalPayment.amount,
          status,
          stripePaymentIntentId: paymentIntent.id,
        };

        console.log(`[MISSION CONFIRMATION] Final payment triggered: ${JSON.stringify(paymentResult)}`);
      } else {
        console.log(`[MISSION CONFIRMATION] No pending final payment found for ${missionAgreementId}`);
        paymentResult = { info: "No pending final payment found" };
      }
    } catch (paymentError) {
      console.error(`[MISSION CONFIRMATION] Final payment error:`, paymentError);
      paymentResult = { error: paymentError.message };
    }
  }

  return {
    agreement: mapMissionAgreementRowToDto(updated),
    confirmationStatus: {
      companyConfirmed: !!updated.company_confirmed_end_at,
      detailerConfirmed: !!updated.detailer_confirmed_end_at,
      bothConfirmed: triggerFinalPayment,
    },
    paymentResult,
    newStatus,
  };
}

// ============================================================
// 3. SUSPEND MISSION
// ============================================================

/**
 * Suspendre une mission active. Les paiements mensuels sont mis en pause.
 * 
 * @param {string} missionAgreementId
 * @param {string} userId
 * @param {string} role
 * @param {string} reason - Raison de la suspension
 * @returns {Promise<Object>}
 */
export async function suspendMission(missionAgreementId, userId, role, reason) {
  if (!reason || reason.trim() === "") {
    const err = new Error("Suspension reason is required");
    err.statusCode = 400;
    throw err;
  }

  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    const err = new Error("Mission Agreement not found");
    err.statusCode = 404;
    throw err;
  }

  assertOwnership(agreement, userId, role);

  // Only active missions can be suspended
  validateTransition(agreement.status, "suspended");

  const now = new Date().toISOString();

  // 1) Update agreement
  const { data: updated, error: updateError } = await supabase
    .from("mission_agreements")
    .update({
      status: "suspended",
      suspended_at: now,
      suspension_reason: reason,
      suspended_by: role === "provider" ? "detailer" : role,
      updated_at: now,
    })
    .eq("id", missionAgreementId)
    .select("*")
    .single();

  if (updateError) throw updateError;

  // 2) Put pending payments on hold
  const { data: pendingPayments } = await supabase
    .from("mission_payments")
    .select("id, status")
    .eq("mission_agreement_id", missionAgreementId)
    .in("status", ["pending", "authorized"]);

  if (pendingPayments && pendingPayments.length > 0) {
    for (const payment of pendingPayments) {
      await supabase
        .from("mission_payments")
        .update({ status: "on_hold", updated_at: now })
        .eq("id", payment.id);
    }
    console.log(`[MISSION CONFIRMATION] ${pendingPayments.length} payments put on hold for ${missionAgreementId}`);
  }

  // 3) Audit log
  await logConfirmationAction(
    missionAgreementId,
    "suspend",
    userId,
    role,
    agreement.status,
    "suspended",
    { reason, paymentsOnHold: pendingPayments?.length || 0 }
  );

  // 4) Notifications
  const otherPartyId = role === "company" ? agreement.detailerId : agreement.companyId;
  const actorLabel = role === "company" ? "La company" : "Le detailer";

  await sendMissionNotification(
    otherPartyId,
    "Mission suspendue",
    `${actorLabel} a suspendu la mission "${agreement.title || ""}". Raison : ${reason}`,
    "mission_suspended",
    missionAgreementId
  );

  return {
    agreement: mapMissionAgreementRowToDto(updated),
    paymentsOnHold: pendingPayments?.length || 0,
  };
}

// ============================================================
// 4. RESUME MISSION
// ============================================================

/**
 * Reprendre une mission suspendue. Les paiements en hold redeviennent pending.
 * 
 * @param {string} missionAgreementId
 * @param {string} userId
 * @param {string} role
 * @returns {Promise<Object>}
 */
export async function resumeMission(missionAgreementId, userId, role) {
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    const err = new Error("Mission Agreement not found");
    err.statusCode = 404;
    throw err;
  }

  assertOwnership(agreement, userId, role);

  // Only suspended missions can be resumed
  validateTransition(agreement.status, "active");

  const now = new Date().toISOString();

  // 1) Update agreement
  const { data: updated, error: updateError } = await supabase
    .from("mission_agreements")
    .update({
      status: "active",
      resumed_at: now,
      updated_at: now,
    })
    .eq("id", missionAgreementId)
    .select("*")
    .single();

  if (updateError) throw updateError;

  // 2) Resume on_hold payments
  const { data: holdPayments } = await supabase
    .from("mission_payments")
    .select("id")
    .eq("mission_agreement_id", missionAgreementId)
    .eq("status", "on_hold");

  if (holdPayments && holdPayments.length > 0) {
    for (const payment of holdPayments) {
      await supabase
        .from("mission_payments")
        .update({ status: "pending", updated_at: now })
        .eq("id", payment.id);
    }
    console.log(`[MISSION CONFIRMATION] ${holdPayments.length} payments resumed for ${missionAgreementId}`);
  }

  // 3) Audit log
  await logConfirmationAction(
    missionAgreementId,
    "resume",
    userId,
    role,
    "suspended",
    "active",
    { paymentsResumed: holdPayments?.length || 0 }
  );

  // 4) Notifications
  const otherPartyId = role === "company" ? agreement.detailerId : agreement.companyId;
  const actorLabel = role === "company" ? "La company" : "Le detailer";

  await sendMissionNotification(
    otherPartyId,
    "Mission reprise",
    `${actorLabel} a repris la mission "${agreement.title || ""}". Les paiements reprennent normalement.`,
    "mission_resumed",
    missionAgreementId
  );

  return {
    agreement: mapMissionAgreementRowToDto(updated),
    paymentsResumed: holdPayments?.length || 0,
  };
}

// ============================================================
// 5. GET CONFIRMATION STATUS
// ============================================================

/**
 * Retourne le statut de confirmation d'une mission.
 * Utile pour l'UI des boutons de confirmation.
 */
export async function getConfirmationStatus(missionAgreementId) {
  const { data, error } = await supabase
    .from("mission_agreements")
    .select(`
      status,
      company_confirmed_start_at,
      detailer_confirmed_start_at,
      company_confirmed_end_at,
      detailer_confirmed_end_at,
      suspended_at,
      resumed_at,
      suspension_reason,
      suspended_by,
      start_date,
      end_date
    `)
    .eq("id", missionAgreementId)
    .single();

  if (error) throw error;
  if (!data) return null;

  const now = new Date();
  const startDate = data.start_date ? new Date(data.start_date) : null;
  const endDate = data.end_date ? new Date(data.end_date) : null;

  return {
    status: data.status,
    start: {
      companyConfirmed: !!data.company_confirmed_start_at,
      companyConfirmedAt: data.company_confirmed_start_at,
      detailerConfirmed: !!data.detailer_confirmed_start_at,
      detailerConfirmedAt: data.detailer_confirmed_start_at,
      bothConfirmed: !!data.company_confirmed_start_at && !!data.detailer_confirmed_start_at,
      canConfirm: startDate ? now >= new Date(startDate.getTime() - 86400000) : false, // 1 day before
    },
    end: {
      companyConfirmed: !!data.company_confirmed_end_at,
      companyConfirmedAt: data.company_confirmed_end_at,
      detailerConfirmed: !!data.detailer_confirmed_end_at,
      detailerConfirmedAt: data.detailer_confirmed_end_at,
      bothConfirmed: !!data.company_confirmed_end_at && !!data.detailer_confirmed_end_at,
      canConfirm: endDate ? now >= new Date(endDate.getTime() - 86400000) : false, // 1 day before end
    },
    suspension: data.suspended_at ? {
      suspendedAt: data.suspended_at,
      resumedAt: data.resumed_at,
      reason: data.suspension_reason,
      suspendedBy: data.suspended_by,
    } : null,
  };
}
