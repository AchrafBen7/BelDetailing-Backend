// src/services/missionPaymentScheduleIntelligent.service.js
import { createMissionPayment } from "./missionPayment.service.js";
import { getMissionAgreementById } from "./missionAgreement.service.js";
import { createPaymentIntentForMission } from "./missionPaymentStripe.service.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";

/**
 * 🟦 CREATE INTELLIGENT PAYMENT SCHEDULE – Créer un plan de paiement intelligent selon la durée
 * 
 * Règles :
 * - Mission < 1 mois : Acompte fin jour 1, solde dernier jour
 * - Mission ≥ 1 mois : 20% jour 1, commission NIOS 7% immédiate, reste réparti mensuellement
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @param {boolean} authorizeAll - Si true, autorise tous les paiements immédiatement
 * @returns {Promise<Object>} Plan de paiement créé avec détails
 */
export async function createIntelligentPaymentSchedule(missionAgreementId, authorizeAll = true) {
  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  if (!agreement.finalPrice || !agreement.depositAmount || !agreement.remainingAmount) {
    throw new Error("Mission Agreement missing price information");
  }

  if (!agreement.startDate || !agreement.endDate) {
    throw new Error("Mission Agreement missing dates");
  }

  // 2) Calculer la durée en jours
  const startDate = new Date(agreement.startDate);
  const endDate = new Date(agreement.endDate);
  const durationDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  const durationMonths = Math.ceil(durationDays / 30);

  const payments = [];
  const totalAmount = agreement.finalPrice;
  const commissionAmount = Math.round(totalAmount * MISSION_COMMISSION_RATE * 100) / 100; // 7%
  const detailerAmount = Math.round((totalAmount - commissionAmount) * 100) / 100;

  console.log(`📅 [PAYMENT SCHEDULE] Mission duration: ${durationDays} days (${durationMonths} months)`);
  console.log(`💰 [PAYMENT SCHEDULE] Total: ${totalAmount}€, Commission: ${commissionAmount}€, Detailer: ${detailerAmount}€`);

  // 3) CAS 1 : Mission < 1 mois (< 30 jours)
  if (durationDays < 30) {
    console.log("📅 [PAYMENT SCHEDULE] Short mission (< 1 month) - Simple schedule");

    // Acompte : fin du jour 1 (startDate + 1 jour à 23:59)
    const depositDate = new Date(startDate);
    depositDate.setDate(depositDate.getDate() + 1);
    depositDate.setHours(23, 59, 59, 999);

    const depositPayment = await createMissionPayment({
      missionAgreementId,
      type: "deposit",
      amount: agreement.depositAmount,
      scheduledDate: depositDate.toISOString(),
    });
    payments.push(depositPayment);

    // Solde : dernier jour (endDate à 23:59)
    const finalDate = new Date(endDate);
    finalDate.setHours(23, 59, 59, 999);

    const finalPayment = await createMissionPayment({
      missionAgreementId,
      type: "final",
      amount: agreement.remainingAmount,
      scheduledDate: finalDate.toISOString(),
    });
    payments.push(finalPayment);

    // Autoriser les paiements si demandé
    if (authorizeAll) {
      try {
        await createPaymentIntentForMission({
          missionAgreementId,
          paymentId: depositPayment.id,
          amount: agreement.depositAmount,
          type: "deposit",
        });
        console.log(`✅ [PAYMENT SCHEDULE] Deposit authorized: ${depositPayment.id}`);
      } catch (err) {
        console.error(`❌ [PAYMENT SCHEDULE] Failed to authorize deposit:`, err);
      }

      try {
        await createPaymentIntentForMission({
          missionAgreementId,
          paymentId: finalPayment.id,
          amount: agreement.remainingAmount,
          type: "final",
        });
        console.log(`✅ [PAYMENT SCHEDULE] Final payment authorized: ${finalPayment.id}`);
      } catch (err) {
        console.error(`❌ [PAYMENT SCHEDULE] Failed to authorize final payment:`, err);
      }
    }

    return {
      scheduleType: "short_mission",
      durationDays,
      payments,
      summary: {
        totalAmount,
        depositAmount: agreement.depositAmount,
        remainingAmount: agreement.remainingAmount,
        commissionAmount: 0, // Commission incluse dans les paiements
        paymentCount: 2,
      },
    };
  }

  // 4) CAS 2 : Mission ≥ 1 mois (≥ 30 jours)
  console.log("📅 [PAYMENT SCHEDULE] Long mission (≥ 1 month) - Complex schedule");

  // 4.1) Acompte : 20% au jour 1 (startDate + 1 jour à 23:59)
  const depositDate = new Date(startDate);
  depositDate.setDate(depositDate.getDate() + 1);
  depositDate.setHours(23, 59, 59, 999);

  const deposit20Percent = Math.round((totalAmount * 0.20) * 100) / 100;
  const depositPayment = await createMissionPayment({
    missionAgreementId,
    type: "deposit",
    amount: deposit20Percent,
    scheduledDate: depositDate.toISOString(),
  });
  payments.push(depositPayment);

  // 4.2) Commission NIOS : 7% 
  // ⚠️ IMPORTANT : La commission sera prélevée via application_fee_amount dans Stripe
  // On ne crée PAS de paiement séparé pour la commission dans mission_payments
  // Elle sera gérée automatiquement par Stripe lors de chaque capture

  // 4.3) Solde restant : réparti mensuellement
  // ⚠️ IMPORTANT : La commission sera prélevée via Stripe (application_fee_amount ou Transfer)
  // On ne la soustrait PAS du solde restant ici
  const remainingAfterDeposit = Math.round((totalAmount - deposit20Percent) * 100) / 100;
  const monthlyInstallments = Math.max(1, durationMonths - 1); // -1 car le premier mois est l'acompte
  const monthlyAmount = Math.round((remainingAfterDeposit / monthlyInstallments) * 100) / 100;

  console.log(`💰 [PAYMENT SCHEDULE] Remaining after deposit: ${remainingAfterDeposit}€`);
  console.log(`📅 [PAYMENT SCHEDULE] Monthly installments: ${monthlyInstallments} x ${monthlyAmount}€`);

  // Créer les paiements mensuels
  for (let month = 1; month <= monthlyInstallments; month++) {
    const monthlyDate = new Date(startDate);
    monthlyDate.setMonth(monthlyDate.getMonth() + month);
    monthlyDate.setDate(1); // Premier jour du mois
    monthlyDate.setHours(23, 59, 59, 999);

    // Ajuster le dernier paiement pour éviter les arrondis
    const installmentAmount = month === monthlyInstallments
      ? remainingAfterDeposit - (monthlyAmount * (monthlyInstallments - 1))
      : monthlyAmount;

    const monthlyPayment = await createMissionPayment({
      missionAgreementId,
      type: "monthly",
      amount: Math.round(installmentAmount * 100) / 100,
      scheduledDate: monthlyDate.toISOString(),
      monthNumber: month,
    });
    payments.push(monthlyPayment);
  }

  // Autoriser tous les paiements si demandé
  if (authorizeAll) {
    for (const payment of payments) {
      try {
        await createPaymentIntentForMission({
          missionAgreementId,
          paymentId: payment.id,
          amount: payment.amount,
          type: payment.type,
        });
        console.log(`✅ [PAYMENT SCHEDULE] Payment authorized: ${payment.id} (${payment.type})`);
      } catch (err) {
        console.error(`❌ [PAYMENT SCHEDULE] Failed to authorize payment ${payment.id}:`, err);
      }
    }
  }

  return {
    scheduleType: "long_mission",
    durationDays,
    durationMonths,
    payments,
    summary: {
      totalAmount,
      depositAmount: deposit20Percent,
      commissionAmount,
      remainingAmount: remainingAfterDeposit,
      monthlyInstallments,
      monthlyAmount,
      paymentCount: payments.length,
    },
  };
}

/**
 * 🟦 GET PAYMENT SCHEDULE SUMMARY – Récapitulatif du plan de paiement
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Object>} Récapitulatif du plan de paiement
 */
export async function getPaymentScheduleSummary(missionAgreementId) {
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  const { getMissionPaymentsForAgreement } = await import("./missionPayment.service.js");
  const payments = await getMissionPaymentsForAgreement(missionAgreementId);

  if (!agreement.startDate || !agreement.endDate) {
    return {
      scheduleType: "not_configured",
      payments: [],
      summary: {
        totalAmount: agreement.finalPrice || 0,
        paymentCount: 0,
      },
    };
  }

  const startDate = new Date(agreement.startDate);
  const endDate = new Date(agreement.endDate);
  const durationDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  const durationMonths = Math.ceil(durationDays / 30);

  const scheduleType = durationDays < 30 ? "short_mission" : "long_mission";

  // Trier les paiements par date
  const sortedPayments = payments.sort((a, b) => {
    if (!a.scheduledDate && !b.scheduledDate) return 0;
    if (!a.scheduledDate) return 1;
    if (!b.scheduledDate) return -1;
    return new Date(a.scheduledDate) - new Date(b.scheduledDate);
  });

  return {
    scheduleType,
    durationDays,
    durationMonths,
    payments: sortedPayments,
    summary: {
      totalAmount: agreement.finalPrice || 0,
      depositAmount: agreement.depositAmount || 0,
      remainingAmount: agreement.remainingAmount || 0,
      commissionAmount: Math.round((agreement.finalPrice || 0) * MISSION_COMMISSION_RATE * 100) / 100,
      paymentCount: payments.length,
      authorizedCount: payments.filter(p => p.status === "authorized").length,
      capturedCount: payments.filter(p => p.status === "captured").length,
    },
  };
}
