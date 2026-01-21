// src/services/missionAgreementPdf.service.js
import { htmlToPdf } from "./pdf.service.js";
import { getMissionAgreementById } from "./missionAgreement.service.js";
import { getMissionPaymentsForAgreement } from "./missionPayment.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";

/**
 * 🟦 GENERATE MISSION AGREEMENT PDF – Générer le PDF d'un Mission Agreement
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Buffer>} Buffer du PDF généré
 */
export async function generateMissionAgreementPdf(missionAgreementId) {
  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  // 2) Récupérer les informations de la company
  const { data: companyUser, error: companyError } = await supabase
    .from("users")
    .select("email, phone")
    .eq("id", agreement.companyId)
    .single();

  if (companyError) {
    console.warn("[MISSION AGREEMENT PDF] Error fetching company user:", companyError);
  }

  const { data: companyProfile, error: companyProfileError } = await supabase
    .from("company_profiles")
    .select("legal_name, city, postal_code, contact_name")
    .eq("user_id", agreement.companyId)
    .maybeSingle();

  if (companyProfileError) {
    console.warn("[MISSION AGREEMENT PDF] Error fetching company profile:", companyProfileError);
  }

  // 3) Récupérer les informations du detailer
  const { data: detailerUser, error: detailerError } = await supabase
    .from("users")
    .select("email, phone")
    .eq("id", agreement.detailerId)
    .single();

  if (detailerError) {
    console.warn("[MISSION AGREEMENT PDF] Error fetching detailer user:", detailerError);
  }

  const { data: detailerProfile, error: detailerProfileError } = await supabase
    .from("provider_profiles")
    .select("display_name, base_city, postal_code, phone, email")
    .eq("user_id", agreement.detailerId)
    .maybeSingle();

  if (detailerProfileError) {
    console.warn("[MISSION AGREEMENT PDF] Error fetching detailer profile:", detailerProfileError);
  }

  // 4) Récupérer les paiements
  const payments = await getMissionPaymentsForAgreement(missionAgreementId);

  // 5) Calculer les montants
  const totalAmount = agreement.finalPrice || 0;
  const depositAmount = agreement.depositAmount || 0;
  const remainingAmount = agreement.remainingAmount || 0;
  const commissionAmount = Math.round(totalAmount * MISSION_COMMISSION_RATE * 100) / 100;
  const netAmount = Math.round((totalAmount - commissionAmount) * 100) / 100;

  // 6) Formater les dates
  const formatDate = (dateString) => {
    if (!dateString) return "Non défini";
    const date = new Date(dateString);
    return date.toLocaleDateString("fr-BE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // 7) Générer le HTML
  const html = generateMissionAgreementHtml({
    agreement,
    companyUser,
    companyProfile,
    detailerUser,
    detailerProfile,
    payments,
    totalAmount,
    depositAmount,
    remainingAmount,
    commissionAmount,
    netAmount,
    formatDate,
  });

  // 8) Convertir en PDF
  const pdfBuffer = await htmlToPdf(html);

  return pdfBuffer;
}

/**
 * 🟦 GENERATE HTML – Générer le HTML du Mission Agreement
 */
function generateMissionAgreementHtml({
  agreement,
  companyUser,
  companyProfile,
  detailerUser,
  detailerProfile,
  payments,
  totalAmount,
  depositAmount,
  remainingAmount,
  commissionAmount,
  netAmount,
  formatDate,
}) {
  const companyName = companyProfile?.legal_name || companyUser?.email || "Non défini";
  const companyCity = companyProfile?.city || "";
  const companyPostalCode = companyProfile?.postal_code || "";
  const companyContact = companyProfile?.contact_name || "";
  const companyEmail = companyUser?.email || "";
  const companyPhone = companyUser?.phone || "";

  const detailerName = detailerProfile?.display_name || detailerUser?.email || "Non défini";
  const detailerCity = detailerProfile?.base_city || "";
  const detailerPostalCode = detailerProfile?.postal_code || "";
  const detailerEmail = detailerProfile?.email || detailerUser?.email || "";
  const detailerPhone = detailerProfile?.phone || detailerUser?.phone || "";

  const paymentScheduleHtml = generatePaymentScheduleHtml(payments, formatDate);

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mission Agreement - ${agreement.title || "Mission"}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 12px;
      line-height: 1.6;
      color: #000;
      background: #fff;
      padding: 40px;
    }
    .header {
      border-bottom: 3px solid #000;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 10px;
    }
    .header .subtitle {
      font-size: 14px;
      color: #666;
    }
    .section {
      margin-bottom: 30px;
    }
    .section-title {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 15px;
      border-bottom: 2px solid #000;
      padding-bottom: 5px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .info-block {
      background: #f9f9f9;
      padding: 15px;
      border-radius: 8px;
    }
    .info-block h3 {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 10px;
      color: #000;
    }
    .info-block p {
      margin: 5px 0;
      font-size: 12px;
    }
    .mission-details {
      background: #fff;
      border: 1px solid #ddd;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .mission-details h3 {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 15px;
    }
    .mission-details p {
      margin: 8px 0;
      font-size: 12px;
    }
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
      font-size: 12px;
    }
    .amounts-table td {
      font-size: 12px;
    }
    .amounts-table .total-row {
      font-weight: bold;
      background: #f9f9f9;
    }
    .amounts-table .amount {
      text-align: right;
      font-family: 'Courier New', monospace;
    }
    .payment-schedule {
      margin-top: 20px;
    }
    .payment-item {
      background: #f9f9f9;
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 8px;
      border-left: 4px solid #000;
    }
    .payment-item h4 {
      font-size: 13px;
      font-weight: bold;
      margin-bottom: 8px;
    }
    .payment-item p {
      font-size: 11px;
      margin: 4px 0;
      color: #666;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      font-size: 10px;
      color: #666;
      text-align: center;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: bold;
      text-transform: uppercase;
    }
    .status-active {
      background: #000;
      color: #fff;
    }
    .status-draft {
      background: #ddd;
      color: #000;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Mission Agreement</h1>
    <p class="subtitle">Contrat de mission NIOS</p>
    <p class="subtitle">Référence: ${agreement.id}</p>
  </div>

  <div class="section">
    <h2 class="section-title">Informations générales</h2>
    <div class="info-grid">
      <div class="info-block">
        <h3>Entreprise (Client)</h3>
        <p><strong>${companyName}</strong></p>
        ${companyContact ? `<p>Contact: ${companyContact}</p>` : ""}
        ${companyCity || companyPostalCode ? `<p>${companyCity} ${companyPostalCode}</p>` : ""}
        ${companyEmail ? `<p>Email: ${companyEmail}</p>` : ""}
        ${companyPhone ? `<p>Téléphone: ${companyPhone}</p>` : ""}
      </div>
      <div class="info-block">
        <h3>Detailer (Prestataire)</h3>
        <p><strong>${detailerName}</strong></p>
        ${detailerCity || detailerPostalCode ? `<p>${detailerCity} ${detailerPostalCode}</p>` : ""}
        ${detailerEmail ? `<p>Email: ${detailerEmail}</p>` : ""}
        ${detailerPhone ? `<p>Téléphone: ${detailerPhone}</p>` : ""}
      </div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">Détails de la mission</h2>
    <div class="mission-details">
      <h3>${agreement.title || "Mission"}</h3>
      ${agreement.description ? `<p><strong>Description:</strong> ${agreement.description}</p>` : ""}
      <p><strong>Localisation:</strong> ${agreement.locationCity || ""} ${agreement.locationPostalCode || ""}</p>
      <p><strong>Nombre de véhicules:</strong> ${agreement.vehicleCount || 0}</p>
      ${agreement.startDate ? `<p><strong>Date de début:</strong> ${formatDate(agreement.startDate)}</p>` : ""}
      ${agreement.endDate ? `<p><strong>Date de fin:</strong> ${formatDate(agreement.endDate)}</p>` : ""}
      ${agreement.estimatedDurationDays ? `<p><strong>Durée estimée:</strong> ${agreement.estimatedDurationDays} jours</p>` : ""}
      <p><strong>Statut:</strong> <span class="status-badge status-${agreement.status || "draft"}">${agreement.status || "draft"}</span></p>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">Montants et paiements</h2>
    <table class="amounts-table">
      <thead>
        <tr>
          <th>Description</th>
          <th class="amount">Montant (€)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Montant total de la mission</td>
          <td class="amount">${totalAmount.toFixed(2)}</td>
        </tr>
        <tr>
          <td>Acompte (${agreement.depositPercentage || 0}%)</td>
          <td class="amount">${depositAmount.toFixed(2)}</td>
        </tr>
        <tr>
          <td>Solde restant</td>
          <td class="amount">${remainingAmount.toFixed(2)}</td>
        </tr>
        <tr class="total-row">
          <td><strong>Total</strong></td>
          <td class="amount"><strong>${totalAmount.toFixed(2)}</strong></td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top: 20px; padding: 15px; background: #f9f9f9; border-radius: 8px;">
      <h3 style="font-size: 13px; font-weight: bold; margin-bottom: 10px;">Commission NIOS (${(MISSION_COMMISSION_RATE * 100).toFixed(0)}%)</h3>
      <p style="font-size: 11px; margin: 5px 0;">Montant brut: ${totalAmount.toFixed(2)} €</p>
      <p style="font-size: 11px; margin: 5px 0;">Commission: ${commissionAmount.toFixed(2)} €</p>
      <p style="font-size: 11px; margin: 5px 0; font-weight: bold;">Montant net pour le detailer: ${netAmount.toFixed(2)} €</p>
    </div>
  </div>

  ${paymentScheduleHtml}

  <div class="footer">
    <p>Document généré automatiquement par NIOS le ${formatDate(new Date().toISOString())}</p>
    <p>Ce document constitue un accord contractuel entre les parties mentionnées ci-dessus.</p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * 🟦 GENERATE PAYMENT SCHEDULE HTML – Générer le HTML du planning de paiement
 */
function generatePaymentScheduleHtml(payments, formatDate) {
  if (!payments || payments.length === 0) {
    return `
  <div class="section">
    <h2 class="section-title">Planning de paiement</h2>
    <p style="color: #666; font-size: 11px;">Aucun paiement programmé pour le moment.</p>
  </div>
    `;
  }

  const paymentItems = payments.map((payment) => {
    const typeLabels = {
      deposit: "Acompte",
      installment: "Échéance",
      final: "Solde final",
      monthly: "Paiement mensuel",
    };

    const statusLabels = {
      pending: "En attente",
      authorized: "Autorisé",
      captured: "Capturé",
      failed: "Échoué",
      refunded: "Remboursé",
      cancelled: "Annulé",
    };

    const typeLabel = typeLabels[payment.type] || payment.type;
    const statusLabel = statusLabels[payment.status] || payment.status;
    const amount = payment.amount ? payment.amount.toFixed(2) : "0.00";
    const scheduledDate = payment.scheduledDate ? formatDate(payment.scheduledDate) : "Non défini";

    let title = typeLabel;
    if (payment.type === "installment" && payment.installmentNumber) {
      title = `${typeLabel} ${payment.installmentNumber}`;
    } else if (payment.type === "monthly" && payment.monthNumber) {
      title = `${typeLabel} - Mois ${payment.monthNumber}`;
    }

    return `
      <div class="payment-item">
        <h4>${title}</h4>
        <p><strong>Montant:</strong> ${amount} €</p>
        <p><strong>Date prévue:</strong> ${scheduledDate}</p>
        <p><strong>Statut:</strong> ${statusLabel}</p>
      </div>
    `;
  }).join("");

  return `
  <div class="section">
    <h2 class="section-title">Planning de paiement</h2>
    <div class="payment-schedule">
      ${paymentItems}
    </div>
  </div>
  `;
}

/**
 * 🟦 UPLOAD PDF TO STORAGE – Uploader le PDF dans Supabase Storage
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @param {Buffer} pdfBuffer - Buffer du PDF
 * @returns {Promise<string>} URL publique du PDF
 */
export async function uploadMissionAgreementPdf(missionAgreementId, pdfBuffer) {
  const fileName = `mission-agreement-${missionAgreementId}-${Date.now()}.pdf`;
  const filePath = `mission-agreements/${fileName}`;

  const { data, error } = await supabase.storage
    .from("media")
    .upload(filePath, pdfBuffer, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    console.error("[MISSION AGREEMENT PDF] Upload error:", error);
    throw error;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("media").getPublicUrl(filePath);

  return publicUrl;
}

/**
 * 🟦 GENERATE AND SAVE PDF – Générer et sauvegarder le PDF d'un Mission Agreement
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<string>} URL publique du PDF
 */
export async function generateAndSaveMissionAgreementPdf(missionAgreementId) {
  // 1) Générer le PDF
  const pdfBuffer = await generateMissionAgreementPdf(missionAgreementId);

  // 2) Uploader dans Supabase Storage
  const pdfUrl = await uploadMissionAgreementPdf(missionAgreementId, pdfBuffer);

  // 3) Mettre à jour le Mission Agreement avec l'URL du PDF
  const { updateMissionAgreementPdfUrl } = await import("./missionAgreement.service.js");
  await updateMissionAgreementPdfUrl(missionAgreementId, pdfUrl);

  console.log(`✅ [MISSION AGREEMENT PDF] Generated and saved: ${pdfUrl}`);

  return pdfUrl;
}
