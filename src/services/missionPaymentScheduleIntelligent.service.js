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

    // ⚠️ IMPORTANT : L'acompte sera créé et capturé au jour 1 via captureDayOnePayments
    // On ne crée PAS l'acompte ici, seulement le paiement final

    // Solde : dernier jour (endDate à 23:59)
    const finalDate = new Date(endDate);
    finalDate.setHours(23, 59, 59, 999);

    const finalPayment = await createMissionPayment({
      missionAgreementId,
      type: "final",
      amount: agreement.remainingAmount, // 2400€ (solde restant après acompte)
      scheduledDate: finalDate.toISOString(),
    });
    payments.push(finalPayment);

    // ⚠️ CRITICAL: Ne PAS autoriser automatiquement le paiement final
    // Il sera autorisé après le premier paiement on-session réussi (via webhook)
    console.log(`⚠️ [PAYMENT SCHEDULE] Final payment will be authorized after first on-session payment succeeds`);

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

  // ⚠️ IMPORTANT : L'acompte (20%) sera créé et capturé au jour 1 via captureDayOnePayments
  // On ne crée PAS l'acompte ici, seulement les paiements mensuels

  // 4.1) Commission NIOS : 7% 
  // ⚠️ IMPORTANT : La commission sera créée et capturée au jour 1 via captureDayOnePayments
  // On ne crée PAS de paiement séparé pour la commission dans mission_payments

  // 4.2) Solde restant : réparti mensuellement
  // ⚠️ IMPORTANT : L'acompte (20%) sera capturé au jour 1, donc le solde restant = total - 20%
  const deposit20Percent = Math.round((totalAmount * 0.20) * 100) / 100; // 600€ (20% de 3000€)
  const remainingAfterDeposit = Math.round((totalAmount - deposit20Percent) * 100) / 100; // 2400€
  const monthlyInstallments = Math.max(1, durationMonths - 1); // -1 car le premier mois est l'acompte
  const monthlyAmount = Math.round((remainingAfterDeposit / monthlyInstallments) * 100) / 100;

  console.log(`💰 [PAYMENT SCHEDULE] Remaining after deposit: ${remainingAfterDeposit}€`);
  console.log(`📅 [PAYMENT SCHEDULE] Monthly installments: ${monthlyInstallments} x ${monthlyAmount}€`);

  // Créer les paiements mensuels
  for (let month = 1; month <= monthlyInstallments; month++) {
    let scheduledDate;
    
    if (month === monthlyInstallments) {
      // ✅ Dernier paiement : dernier jour de la mission (endDate à 23:59)
      scheduledDate = new Date(endDate);
      scheduledDate.setHours(23, 59, 59, 999);
    } else {
      // Paiements intermédiaires : premier jour du mois suivant
      scheduledDate = new Date(startDate);
      scheduledDate.setMonth(scheduledDate.getMonth() + month);
      scheduledDate.setDate(1); // Premier jour du mois
      scheduledDate.setHours(23, 59, 59, 999);
    }

    // Ajuster le dernier paiement pour éviter les arrondis
    const installmentAmount = month === monthlyInstallments
      ? remainingAfterDeposit - (monthlyAmount * (monthlyInstallments - 1))
      : monthlyAmount;

    const monthlyPayment = await createMissionPayment({
      missionAgreementId,
      type: month === monthlyInstallments ? "final" : "monthly", // ✅ Dernier paiement = type "final"
      amount: Math.round(installmentAmount * 100) / 100,
      scheduledDate: scheduledDate.toISOString(),
      monthNumber: month === monthlyInstallments ? null : month, // ✅ Pas de monthNumber pour le paiement final
    });
    payments.push(monthlyPayment);
  }

    // ⚠️ CRITICAL: Ne PAS autoriser automatiquement les paiements programmés (monthly/final)
    // Stripe bloque les paiements SEPA off_session si le mandate n'a pas été utilisé en on-session avant
    // Les paiements programmés seront autorisés automatiquement après le premier paiement on-session réussi
    // via le webhook payment_intent.succeeded
    if (authorizeAll) {
      console.log(`⚠️ [PAYMENT SCHEDULE] Skipping automatic authorization for scheduled payments (monthly/final)`);
      console.log(`⚠️ [PAYMENT SCHEDULE] These will be authorized after first on-session payment succeeds`);
      // Ne pas créer les PaymentIntents maintenant - ils seront créés automatiquement
      // après que le premier paiement (deposit + commission) soit confirmé on-session
    }

  return {
    scheduleType: "long_mission",
    durationDays,
    durationMonths,
    payments,
    summary: {
      totalAmount,
      depositAmount: deposit20Percent, // Sera capturé au jour 1
      commissionAmount, // Sera capturé au jour 1
      remainingAmount: remainingAfterDeposit, // Paiements mensuels
      monthlyInstallments,
      monthlyAmount,
      paymentCount: payments.length, // Seulement les paiements mensuels (pas l'acompte ni la commission)
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
