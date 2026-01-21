// src/services/missionPaymentSchedule.service.js
import { createMissionPayment } from "./missionPayment.service.js";
import { getMissionAgreementById } from "./missionAgreement.service.js";
import { createPaymentIntentForMission } from "./missionPaymentStripe.service.js";

/**
 * 🟦 CREATE INITIAL PAYMENTS – Créer les paiements initiaux (acompte + solde) pour un Mission Agreement
 * 
 * Cette fonction crée automatiquement :
 * 1. Un paiement d'acompte (deposit) avec autorisation immédiate
 * 2. Un ou plusieurs paiements de solde (installment ou final) selon le payment_schedule
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @param {boolean} authorizeAll - Si true, autorise tous les paiements immédiatement (default: true)
 * @returns {Promise<Array>} Liste des paiements créés
 */
export async function createInitialMissionPayments(missionAgreementId, authorizeAll = true) {
  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  if (!agreement.finalPrice || !agreement.depositAmount || !agreement.remainingAmount) {
    throw new Error("Mission Agreement missing price information");
  }

  const payments = [];

  // 2) Créer le paiement d'acompte (deposit)
  const depositPayment = await createMissionPayment({
    missionAgreementId,
    type: "deposit",
    amount: agreement.depositAmount,
    scheduledDate: new Date().toISOString(), // Capture immédiate
  });

  payments.push(depositPayment);

  // 3) Autoriser le paiement d'acompte immédiatement si demandé
  if (authorizeAll) {
    try {
      await createPaymentIntentForMission({
        missionAgreementId,
        paymentId: depositPayment.id,
        amount: agreement.depositAmount,
        type: "deposit",
      });
      console.log(`✅ [MISSION PAYMENT] Deposit payment authorized: ${depositPayment.id}`);
    } catch (err) {
      console.error(`❌ [MISSION PAYMENT] Failed to authorize deposit payment:`, err);
      // Ne pas faire échouer, le paiement pourra être autorisé plus tard
    }
  }

  // 4) Créer les paiements de solde selon le payment_schedule
  const paymentSchedule = agreement.paymentSchedule || { type: "one_shot" };

  if (paymentSchedule.type === "one_shot") {
    // Paiement unique du solde
    const finalPayment = await createMissionPayment({
      missionAgreementId,
      type: "final",
      amount: agreement.remainingAmount,
      scheduledDate: paymentSchedule.finalDate || agreement.endDate || null,
    });

    payments.push(finalPayment);

    // Autoriser le paiement final si demandé
    if (authorizeAll) {
      try {
        await createPaymentIntentForMission({
          missionAgreementId,
          paymentId: finalPayment.id,
          amount: agreement.remainingAmount,
          type: "final",
        });
        console.log(`✅ [MISSION PAYMENT] Final payment authorized: ${finalPayment.id}`);
      } catch (err) {
        console.error(`❌ [MISSION PAYMENT] Failed to authorize final payment:`, err);
      }
    }
  } else if (paymentSchedule.type === "installments") {
    // Paiements fractionnés
    const installmentCount = paymentSchedule.installmentCount || 1;
    const installmentAmount = Math.round((agreement.remainingAmount / installmentCount) * 100) / 100;
    const dates = paymentSchedule.installmentDates || [];

    for (let i = 0; i < installmentCount; i++) {
      const installmentPayment = await createMissionPayment({
        missionAgreementId,
        type: "installment",
        amount: i === installmentCount - 1 
          ? agreement.remainingAmount - (installmentAmount * (installmentCount - 1)) // Ajuster le dernier pour éviter les arrondis
          : installmentAmount,
        scheduledDate: dates[i] || null,
        installmentNumber: i + 1,
      });

      payments.push(installmentPayment);

      // Autoriser chaque échéance si demandé
      if (authorizeAll) {
        try {
          await createPaymentIntentForMission({
            missionAgreementId,
            paymentId: installmentPayment.id,
            amount: installmentPayment.amount,
            type: "installment",
          });
          console.log(`✅ [MISSION PAYMENT] Installment ${i + 1} authorized: ${installmentPayment.id}`);
        } catch (err) {
          console.error(`❌ [MISSION PAYMENT] Failed to authorize installment ${i + 1}:`, err);
        }
      }
    }
  } else if (paymentSchedule.type === "monthly") {
    // Paiements mensuels
    const monthlyAmount = Math.round((agreement.remainingAmount / (paymentSchedule.monthCount || 1)) * 100) / 100;
    const startDate = new Date(agreement.startDate || new Date());

    for (let month = 1; month <= (paymentSchedule.monthCount || 1); month++) {
      const monthDate = new Date(startDate);
      monthDate.setMonth(monthDate.getMonth() + month);

      const monthlyPayment = await createMissionPayment({
        missionAgreementId,
        type: "monthly",
        amount: month === (paymentSchedule.monthCount || 1)
          ? agreement.remainingAmount - (monthlyAmount * ((paymentSchedule.monthCount || 1) - 1)) // Ajuster le dernier
          : monthlyAmount,
        scheduledDate: monthDate.toISOString(),
        monthNumber: month,
      });

      payments.push(monthlyPayment);

      // Autoriser chaque paiement mensuel si demandé
      if (authorizeAll) {
        try {
          await createPaymentIntentForMission({
            missionAgreementId,
            paymentId: monthlyPayment.id,
            amount: monthlyPayment.amount,
            type: "monthly",
          });
          console.log(`✅ [MISSION PAYMENT] Monthly payment ${month} authorized: ${monthlyPayment.id}`);
        } catch (err) {
          console.error(`❌ [MISSION PAYMENT] Failed to authorize monthly payment ${month}:`, err);
        }
      }
    }
  }

  console.log(`✅ [MISSION PAYMENT] Created ${payments.length} initial payments for agreement ${missionAgreementId}`);
  return payments;
}

/**
 * 🟦 AUTHORIZE ALL PAYMENTS – Autoriser tous les paiements d'un Mission Agreement
 * 
 * Cette fonction autorise (mais ne capture pas) tous les paiements en attente d'un Mission Agreement.
 * Utile pour autoriser le montant total dès le début.
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Array>} Liste des paiements autorisés
 */
export async function authorizeAllPayments(missionAgreementId) {
  const { getMissionPaymentsForAgreement } = await import("./missionPayment.service.js");
  
  // Récupérer tous les paiements en attente
  const payments = await getMissionPaymentsForAgreement(missionAgreementId);
  const pendingPayments = payments.filter(p => p.status === "pending");

  const authorizedPayments = [];

  for (const payment of pendingPayments) {
    try {
      await createPaymentIntentForMission({
        missionAgreementId,
        paymentId: payment.id,
        amount: payment.amount,
        type: payment.type,
      });
      authorizedPayments.push(payment);
      console.log(`✅ [MISSION PAYMENT] Authorized payment ${payment.id} (${payment.type})`);
    } catch (err) {
      console.error(`❌ [MISSION PAYMENT] Failed to authorize payment ${payment.id}:`, err);
    }
  }

  return authorizedPayments;
}

/**
 * 🟦 GET NEXT PAYMENT TO CAPTURE – Récupérer le prochain paiement à capturer
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Object|null>} Prochain paiement à capturer ou null
 */
export async function getNextPaymentToCapture(missionAgreementId) {
  const { getMissionPaymentsForAgreement } = await import("./missionPayment.service.js");
  
  const payments = await getMissionPaymentsForAgreement(missionAgreementId);
  
  // Trier par ordre : deposit d'abord, puis par scheduledDate
  const sortedPayments = payments
    .filter(p => p.status === "authorized")
    .sort((a, b) => {
      // Deposit en premier
      if (a.type === "deposit" && b.type !== "deposit") return -1;
      if (a.type !== "deposit" && b.type === "deposit") return 1;
      
      // Puis par scheduledDate
      if (a.scheduledDate && b.scheduledDate) {
        return new Date(a.scheduledDate) - new Date(b.scheduledDate);
      }
      if (a.scheduledDate) return -1;
      if (b.scheduledDate) return 1;
      
      return 0;
    });

  return sortedPayments[0] || null;
}

/**
 * 🟦 GET PAYMENT SUMMARY – Récapitulatif des paiements d'un Mission Agreement
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Object>} Récapitulatif
 */
export async function getPaymentSummary(missionAgreementId) {
  const { getMissionPaymentsForAgreement } = await import("./missionPayment.service.js");
  
  const payments = await getMissionPaymentsForAgreement(missionAgreementId);
  const agreement = await getMissionAgreementById(missionAgreementId);

  const summary = {
    totalAmount: agreement.finalPrice || 0,
    depositAmount: agreement.depositAmount || 0,
    remainingAmount: agreement.remainingAmount || 0,
    payments: {
      pending: payments.filter(p => p.status === "pending").length,
      authorized: payments.filter(p => p.status === "authorized").length,
      captured: payments.filter(p => p.status === "captured").length,
      failed: payments.filter(p => p.status === "failed").length,
    },
    amounts: {
      authorized: payments
        .filter(p => p.status === "authorized")
        .reduce((sum, p) => sum + (p.amount || 0), 0),
      captured: payments
        .filter(p => p.status === "captured")
        .reduce((sum, p) => sum + (p.amount || 0), 0),
      pending: payments
        .filter(p => p.status === "pending")
        .reduce((sum, p) => sum + (p.amount || 0), 0),
    },
    nextPayment: await getNextPaymentToCapture(missionAgreementId),
  };

  return summary;
}
