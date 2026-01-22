// src/services/missionInvoiceAuto.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import {
  createCompanyInvoice,
  createDetailerInvoice,
} from "./missionInvoice.service.js";
import { getMissionAgreementById } from "./missionAgreement.service.js";
import { getMissionPaymentById } from "./missionPayment.service.js";
import { uploadMissionAgreementPdf } from "./missionAgreementPdf.service.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";
import { logger } from "../observability/logger.js";
import { missionInvoicesTotal } from "../observability/metrics.js";

/**
 * 🟦 GENERATE COMPANY INVOICE ON PAYMENT CAPTURE – Générer automatiquement une facture pour la company
 * 
 * Cette fonction est appelée automatiquement lorsqu'un paiement de mission est capturé.
 * Elle génère une facture pour la company avec le montant du paiement.
 * 
 * @param {string} paymentId - ID du paiement capturé (mission_payments)
 * @returns {Promise<Object|null>} Facture créée ou null si erreur
 */
export async function generateCompanyInvoiceOnPaymentCapture(paymentId) {
  try {
    // 1) Récupérer le paiement
    const payment = await getMissionPaymentById(paymentId);
    if (!payment) {
      throw new Error("Payment not found");
    }

    if (payment.status !== "captured") {
      console.warn(`⚠️ [MISSION INVOICE] Payment ${paymentId} is not captured. Status: ${payment.status}`);
      return null;
    }

    // 2) Récupérer le Mission Agreement
    const agreement = await getMissionAgreementById(payment.missionAgreementId);
    if (!agreement) {
      throw new Error("Mission Agreement not found");
    }

    // 3) Vérifier si une facture existe déjà pour ce paiement
    const { data: existingInvoice, error: checkError } = await supabase
      .from("mission_invoices")
      .select("id")
      .eq("mission_payment_id", paymentId)
      .eq("type", "company_invoice")
      .maybeSingle();

    if (checkError) {
      console.error("[MISSION INVOICE] Error checking existing invoice:", checkError);
    }

    if (existingInvoice) {
      console.log(`ℹ️ [MISSION INVOICE] Invoice already exists for payment ${paymentId}`);
      return null; // Facture déjà créée
    }

    // 4) Générer le PDF de la facture
    const pdfBuffer = await generateCompanyInvoicePdf(agreement, payment);
    const pdfUrl = await uploadMissionAgreementPdf(agreement.id, pdfBuffer);

    // 5) Créer la facture
    const invoice = await createCompanyInvoice({
      missionAgreementId: agreement.id,
      missionPaymentId: paymentId,
      totalAmount: payment.amount,
      pdfUrl,
    });

    logger.info({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, paymentId, missionAgreementId: agreement.id, amount: payment.amount }, "[MISSION INVOICE] Company invoice created");
    
    // ✅ MÉTRIQUE : Incrémenter le compteur de factures
    missionInvoicesTotal.inc({ type: "company_invoice" });

    // ✅ ENVOYER NOTIFICATION À LA COMPANY (facture générée)
    try {
      const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
      await sendNotificationWithDeepLink({
        userId: agreement.companyId,
        title: "Facture générée",
        message: `Votre facture ${invoice.invoiceNumber} de ${payment.amount.toFixed(2)}€ a été générée pour le paiement ${payment.type === "deposit" ? "d'acompte" : payment.type === "final" ? "final" : "d'échéance"}.`,
        type: "mission_invoice_generated",
        id: agreement.id,
      });
    } catch (notifError) {
      console.error(`⚠️ [MISSION INVOICE] Notification send failed for company invoice ${invoice.invoiceNumber}:`, notifError);
      // Ne pas faire échouer la génération de facture si la notification échoue
    }

    return invoice;
  } catch (err) {
    // ✅ LOGGING AMÉLIORÉ avec contexte détaillé
    const { logCriticalError, notifyAdmin } = await import("./adminNotification.service.js");
    
    logCriticalError({
      service: "MISSION INVOICE",
      function: "generateCompanyInvoiceOnPaymentCapture",
      error: err,
      context: {
        paymentId,
        missionAgreementId: payment?.missionAgreementId,
        companyId: agreement?.companyId,
        amount: payment?.amount,
      },
    });

    // ✅ NOTIFIER L'ADMIN en cas d'échec de génération de facture
    try {
      await notifyAdmin({
        title: "Génération de facture échouée",
        message: `La génération de la facture company pour le paiement ${paymentId} a échoué. Erreur: ${err.message}`,
        type: "invoice_generation_failed",
        context: {
          paymentId,
          missionAgreementId: payment?.missionAgreementId,
          companyId: agreement?.companyId,
          amount: payment?.amount,
          invoiceType: "company_invoice",
          error: err.message,
        },
      });
    } catch (notifError) {
      console.error("[MISSION INVOICE] Failed to notify admin:", notifError);
    }

    // Ne pas faire échouer le processus, juste logger l'erreur
    return null;
  }
}

/**
 * 🟦 GENERATE DETAILER INVOICE ON PAYMENT CAPTURE – Générer automatiquement une facture de reversement pour le detailer
 * 
 * Cette fonction est appelée automatiquement lorsqu'un paiement de mission est capturé.
 * Elle génère une facture de reversement pour le detailer avec le montant net (après commission).
 * 
 * @param {string} paymentId - ID du paiement capturé (mission_payments)
 * @returns {Promise<Object|null>} Facture créée ou null si erreur
 */
export async function generateDetailerInvoiceOnPaymentCapture(paymentId) {
  try {
    // 1) Récupérer le paiement
    const payment = await getMissionPaymentById(paymentId);
    if (!payment) {
      throw new Error("Payment not found");
    }

    if (payment.status !== "captured") {
      console.warn(`⚠️ [MISSION INVOICE] Payment ${paymentId} is not captured. Status: ${payment.status}`);
      return null;
    }

    // 2) Récupérer le Mission Agreement
    const agreement = await getMissionAgreementById(payment.missionAgreementId);
    if (!agreement) {
      throw new Error("Mission Agreement not found");
    }

    // 3) Vérifier si une facture existe déjà pour ce paiement
    const { data: existingInvoice, error: checkError } = await supabase
      .from("mission_invoices")
      .select("id")
      .eq("mission_payment_id", paymentId)
      .eq("type", "detailer_invoice")
      .maybeSingle();

    if (checkError) {
      console.error("[MISSION INVOICE] Error checking existing invoice:", checkError);
    }

    if (existingInvoice) {
      console.log(`ℹ️ [MISSION INVOICE] Invoice already exists for payment ${paymentId}`);
      return null; // Facture déjà créée
    }

    // 4) Calculer le montant net (après commission)
    const totalAmount = payment.amount;
    const commissionAmount = Math.round(totalAmount * MISSION_COMMISSION_RATE * 100) / 100;
    const netAmount = Math.round((totalAmount - commissionAmount) * 100) / 100;

    // 5) Générer le PDF de la facture de reversement
    const pdfBuffer = await generateDetailerInvoicePdf(agreement, payment, totalAmount, commissionAmount, netAmount);
    const pdfUrl = await uploadMissionAgreementPdf(agreement.id, pdfBuffer);

    // 6) Créer la facture
    const invoice = await createDetailerInvoice({
      missionAgreementId: agreement.id,
      missionPaymentId: paymentId,
      totalAmount,
      commissionRate: MISSION_COMMISSION_RATE,
      pdfUrl,
    });

    logger.info({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, paymentId, missionAgreementId: agreement.id, netAmount }, "[MISSION INVOICE] Detailer invoice created");
    
    // ✅ MÉTRIQUE : Incrémenter le compteur de factures
    missionInvoicesTotal.inc({ type: "detailer_invoice" });

    // ✅ ENVOYER NOTIFICATION AU DETAILER (facture de reversement générée)
    try {
      const { sendNotificationWithDeepLink } = await import("./onesignal.service.js");
      await sendNotificationWithDeepLink({
        userId: agreement.detailerId,
        title: "Facture de reversement générée",
        message: `Votre facture de reversement ${invoice.invoiceNumber} de ${netAmount.toFixed(2)}€ (après commission) a été générée pour le paiement ${payment.type === "deposit" ? "d'acompte" : payment.type === "final" ? "final" : "d'échéance"}.`,
        type: "mission_invoice_generated",
        id: agreement.id,
      });
    } catch (notifError) {
      console.error(`⚠️ [MISSION INVOICE] Notification send failed for detailer invoice ${invoice.invoiceNumber}:`, notifError);
      // Ne pas faire échouer la génération de facture si la notification échoue
    }

    return invoice;
  } catch (err) {
    // ✅ LOGGING AMÉLIORÉ avec contexte détaillé
    const { logCriticalError, notifyAdmin } = await import("./adminNotification.service.js");
    
    logCriticalError({
      service: "MISSION INVOICE",
      function: "generateDetailerInvoiceOnPaymentCapture",
      error: err,
      context: {
        paymentId,
        missionAgreementId: payment?.missionAgreementId,
        detailerId: agreement?.detailerId,
        amount: payment?.amount,
        commissionAmount,
        netAmount,
      },
    });

    // ✅ NOTIFIER L'ADMIN en cas d'échec de génération de facture
    try {
      await notifyAdmin({
        title: "Génération de facture échouée",
        message: `La génération de la facture detailer pour le paiement ${paymentId} a échoué. Erreur: ${err.message}`,
        type: "invoice_generation_failed",
        context: {
          paymentId,
          missionAgreementId: payment?.missionAgreementId,
          detailerId: agreement?.detailerId,
          amount: payment?.amount,
          invoiceType: "detailer_invoice",
          error: err.message,
        },
      });
    } catch (notifError) {
      console.error("[MISSION INVOICE] Failed to notify admin:", notifError);
    }

    // Ne pas faire échouer le processus, juste logger l'erreur
    return null;
  }
}

/**
 * 🟦 GENERATE COMPANY INVOICE PDF – Générer le PDF d'une facture company
 */
async function generateCompanyInvoicePdf(agreement, payment) {
  const { htmlToPdf } = await import("./pdf.service.js");
  const { supabaseAdmin as supabase } = await import("../config/supabase.js");

  // Récupérer les informations de la company
  const { data: companyUser } = await supabase
    .from("users")
    .select("email, phone")
    .eq("id", agreement.companyId)
    .single();

  const { data: companyProfile } = await supabase
    .from("company_profiles")
    .select("legal_name, city, postal_code, contact_name")
    .eq("user_id", agreement.companyId)
    .maybeSingle();

  const formatDate = (dateString) => {
    if (!dateString) return "Non défini";
    const date = new Date(dateString);
    return date.toLocaleDateString("fr-BE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Facture - ${agreement.title || "Mission"}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.6;
      color: #000;
      padding: 40px;
    }
    .header {
      border-bottom: 3px solid #000;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 30px;
    }
    .info-block {
      background: #f9f9f9;
      padding: 15px;
      border-radius: 8px;
    }
    .info-block h3 { font-size: 14px; font-weight: bold; margin-bottom: 10px; }
    .amounts-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    .amounts-table th,
    .amounts-table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    .amounts-table th {
      background: #000;
      color: #fff;
      font-weight: bold;
    }
    .amounts-table .amount { text-align: right; font-family: 'Courier New', monospace; }
    .amounts-table .total-row { font-weight: bold; background: #f9f9f9; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Facture</h1>
    <p>NIOS - Mission Agreement</p>
  </div>

  <div class="info-grid">
    <div class="info-block">
      <h3>Facturé à</h3>
      <p><strong>${companyProfile?.legal_name || companyUser?.email || "Non défini"}</strong></p>
      ${companyProfile?.city ? `<p>${companyProfile.city} ${companyProfile.postal_code || ""}</p>` : ""}
      ${companyUser?.email ? `<p>Email: ${companyUser.email}</p>` : ""}
    </div>
    <div class="info-block">
      <h3>Informations</h3>
      <p><strong>Mission:</strong> ${agreement.title || "Mission"}</p>
      <p><strong>Date de facturation:</strong> ${formatDate(new Date().toISOString())}</p>
      <p><strong>Paiement:</strong> ${payment.type === "deposit" ? "Acompte" : payment.type === "final" ? "Solde" : "Échéance"}</p>
    </div>
  </div>

  <table class="amounts-table">
    <thead>
      <tr>
        <th>Description</th>
        <th class="amount">Montant (€)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${payment.type === "deposit" ? "Acompte" : payment.type === "final" ? "Solde final" : "Échéance"} - ${agreement.title || "Mission"}</td>
        <td class="amount">${payment.amount.toFixed(2)}</td>
      </tr>
      <tr class="total-row">
        <td><strong>Total TTC</strong></td>
        <td class="amount"><strong>${payment.amount.toFixed(2)}</strong></td>
      </tr>
    </tbody>
  </table>

  <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 10px; color: #666; text-align: center;">
    <p>Document généré automatiquement par NIOS</p>
  </div>
</body>
</html>
  `.trim();

  return await htmlToPdf(html);
}

/**
 * 🟦 GENERATE DETAILER INVOICE PDF – Générer le PDF d'une facture de reversement detailer
 */
async function generateDetailerInvoicePdf(agreement, payment, totalAmount, commissionAmount, netAmount) {
  const { htmlToPdf } = await import("./pdf.service.js");
  const { supabaseAdmin as supabase } = await import("../config/supabase.js");

  // Récupérer les informations du detailer
  const { data: detailerUser } = await supabase
    .from("users")
    .select("email, phone")
    .eq("id", agreement.detailerId)
    .single();

  const { data: detailerProfile } = await supabase
    .from("provider_profiles")
    .select("display_name, base_city, postal_code, phone, email")
    .eq("user_id", agreement.detailerId)
    .maybeSingle();

  const formatDate = (dateString) => {
    if (!dateString) return "Non défini";
    const date = new Date(dateString);
    return date.toLocaleDateString("fr-BE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Facture de reversement - ${agreement.title || "Mission"}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.6;
      color: #000;
      padding: 40px;
    }
    .header {
      border-bottom: 3px solid #000;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 30px;
    }
    .info-block {
      background: #f9f9f9;
      padding: 15px;
      border-radius: 8px;
    }
    .info-block h3 { font-size: 14px; font-weight: bold; margin-bottom: 10px; }
    .amounts-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    .amounts-table th,
    .amounts-table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    .amounts-table th {
      background: #000;
      color: #fff;
      font-weight: bold;
    }
    .amounts-table .amount { text-align: right; font-family: 'Courier New', monospace; }
    .amounts-table .total-row { font-weight: bold; background: #f9f9f9; }
    .commission-info {
      margin-top: 20px;
      padding: 15px;
      background: #f9f9f9;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Facture de reversement</h1>
    <p>NIOS - Mission Agreement</p>
  </div>

  <div class="info-grid">
    <div class="info-block">
      <h3>Reversement à</h3>
      <p><strong>${detailerProfile?.display_name || detailerUser?.email || "Non défini"}</strong></p>
      ${detailerProfile?.base_city ? `<p>${detailerProfile.base_city} ${detailerProfile.postal_code || ""}</p>` : ""}
      ${detailerProfile?.email || detailerUser?.email ? `<p>Email: ${detailerProfile?.email || detailerUser?.email}</p>` : ""}
    </div>
    <div class="info-block">
      <h3>Informations</h3>
      <p><strong>Mission:</strong> ${agreement.title || "Mission"}</p>
      <p><strong>Date de facturation:</strong> ${formatDate(new Date().toISOString())}</p>
      <p><strong>Paiement:</strong> ${payment.type === "deposit" ? "Acompte" : payment.type === "final" ? "Solde" : "Échéance"}</p>
    </div>
  </div>

  <table class="amounts-table">
    <thead>
      <tr>
        <th>Description</th>
        <th class="amount">Montant (€)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Montant brut - ${agreement.title || "Mission"}</td>
        <td class="amount">${totalAmount.toFixed(2)}</td>
      </tr>
      <tr>
        <td>Commission NIOS (${(MISSION_COMMISSION_RATE * 100).toFixed(0)}%)</td>
        <td class="amount">-${commissionAmount.toFixed(2)}</td>
      </tr>
      <tr class="total-row">
        <td><strong>Montant net à reverser</strong></td>
        <td class="amount"><strong>${netAmount.toFixed(2)}</strong></td>
      </tr>
    </tbody>
  </table>

  <div class="commission-info">
    <p style="font-size: 11px; margin: 5px 0;"><strong>Détail:</strong></p>
    <p style="font-size: 11px; margin: 5px 0;">Montant brut: ${totalAmount.toFixed(2)} €</p>
    <p style="font-size: 11px; margin: 5px 0;">Commission NIOS (${(MISSION_COMMISSION_RATE * 100).toFixed(0)}%): ${commissionAmount.toFixed(2)} €</p>
    <p style="font-size: 11px; margin: 5px 0; font-weight: bold;">Montant net reversé: ${netAmount.toFixed(2)} €</p>
  </div>

  <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 10px; color: #666; text-align: center;">
    <p>Document généré automatiquement par NIOS</p>
  </div>
</body>
</html>
  `.trim();

  return await htmlToPdf(html);
}
