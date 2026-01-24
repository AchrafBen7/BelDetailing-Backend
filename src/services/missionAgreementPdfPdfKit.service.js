// src/services/missionAgreementPdfPdfKit.service.js
// Alternative utilisant pdfkit (pas de Chrome nécessaire)

import PDFDocument from "pdfkit";
import { getMissionAgreementById } from "./missionAgreement.service.js";
import { getMissionPaymentsForAgreement } from "./missionPayment.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { MISSION_COMMISSION_RATE } from "../config/commission.js";

/**
 * 🟦 GENERATE MISSION AGREEMENT PDF WITH PDFKIT – Générer le PDF avec pdfkit
 * 
 * Alternative à Puppeteer qui ne nécessite pas Chrome.
 * 
 * @param {string} missionAgreementId - ID du Mission Agreement
 * @returns {Promise<Buffer>} Buffer du PDF généré
 */
export async function generateMissionAgreementPdfWithPdfKit(missionAgreementId) {
  // 1) Récupérer le Mission Agreement
  const agreement = await getMissionAgreementById(missionAgreementId);
  if (!agreement) {
    throw new Error("Mission Agreement not found");
  }

  // 2) Récupérer les informations de la company
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

  // 3) Récupérer les informations du detailer
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

  // 7) Générer le PDF avec pdfkit
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Fonction helper pour vérifier et créer une nouvelle page si nécessaire
      const checkPageBreak = (requiredHeight = 50) => {
        if (doc.y + requiredHeight > 750) {
          doc.addPage();
          return true;
        }
        return false;
      };

      // ============================================
      // HEADER PROFESSIONNEL
      // ============================================
      doc.rect(50, 50, 495, 80).fill("#000000");
      doc.fillColor("#FFFFFF")
        .fontSize(24)
        .font("Helvetica-Bold")
        .text("MISSION AGREEMENT", 50, 70, { width: 495, align: "center" });
      doc.fontSize(12)
        .font("Helvetica")
        .text("Contrat de mission NIOS", 50, 100, { width: 495, align: "center" });
      doc.fillColor("#000000");
      
      // Référence du contrat
      doc.fontSize(9)
        .fillColor("#666666")
        .text(`Référence: ${agreement.id}`, 50, 140, { width: 495, align: "right" });
      doc.fillColor("#000000");
      
      doc.moveDown(3);

      // ============================================
      // SECTION 1: PARTIES AU CONTRAT
      // ============================================
      const startY = doc.y;
      
      // Titre de section
      doc.fontSize(16)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("PARTIES AU CONTRAT", 50, startY);
      
      // Ligne de séparation
      doc.moveTo(50, startY + 20)
        .lineTo(545, startY + 20)
        .strokeColor("#000000")
        .lineWidth(2)
        .stroke();
      
      doc.moveDown(1.5);
      const partiesStartY = doc.y;
      
      // Colonne gauche - Company
      const leftColX = 50;
      const colWidth = 240;
      doc.rect(leftColX, partiesStartY, colWidth, 120)
        .fill("#F5F5F5")
        .strokeColor("#CCCCCC")
        .lineWidth(1)
        .stroke();
      
      doc.fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("ENTREPRISE (CLIENT)", leftColX + 10, partiesStartY + 10, { width: colWidth - 20 });
      
      doc.fontSize(10)
        .font("Helvetica")
        .fillColor("#333333");
      
      const companyName = agreement.companyLegalName || companyProfile?.legal_name || companyUser?.email || "Non défini";
      doc.text(companyName, leftColX + 10, partiesStartY + 30, { width: colWidth - 20 });
      
      let currentY = partiesStartY + 45;
      if (agreement.companyVatNumber) {
        doc.text(`TVA: ${agreement.companyVatNumber}`, leftColX + 10, currentY, { width: colWidth - 20 });
        currentY += 15;
      }
      if (agreement.companyRepresentative) {
        doc.text(`Représentant: ${agreement.companyRepresentative}`, leftColX + 10, currentY, { width: colWidth - 20 });
        currentY += 15;
      }
      if (agreement.companyAddress) {
        doc.text(`Adresse: ${agreement.companyAddress}`, leftColX + 10, currentY, { width: colWidth - 20 });
        currentY += 15;
      }
      if (agreement.companyEmail) {
        doc.text(`Email: ${agreement.companyEmail}`, leftColX + 10, currentY, { width: colWidth - 20 });
        currentY += 15;
      }
      
      // Colonne droite - Detailer
      const rightColX = 305;
      doc.rect(rightColX, partiesStartY, colWidth, 120)
        .fill("#F5F5F5")
        .strokeColor("#CCCCCC")
        .lineWidth(1)
        .stroke();
      
      doc.fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("DETAILER (PRESTATAIRE)", rightColX + 10, partiesStartY + 10, { width: colWidth - 20 });
      
      doc.fontSize(10)
        .font("Helvetica")
        .fillColor("#333333");
      
      const detailerName = agreement.detailerLegalName || detailerProfile?.display_name || detailerUser?.email || "Non défini";
      doc.text(detailerName, rightColX + 10, partiesStartY + 30, { width: colWidth - 20 });
      
      currentY = partiesStartY + 45;
      if (agreement.detailerVatNumber) {
        doc.text(`TVA: ${agreement.detailerVatNumber}`, rightColX + 10, currentY, { width: colWidth - 20 });
        currentY += 15;
      }
      if (agreement.detailerAddress) {
        doc.text(`Adresse: ${agreement.detailerAddress}`, rightColX + 10, currentY, { width: colWidth - 20 });
        currentY += 15;
      }
      if (agreement.detailerEmail) {
        doc.text(`Email: ${agreement.detailerEmail}`, rightColX + 10, currentY, { width: colWidth - 20 });
        currentY += 15;
      }
      if (agreement.detailerIban) {
        const maskedIban = `****${agreement.detailerIban.slice(-4)}`;
        doc.text(`IBAN: ${maskedIban}`, rightColX + 10, currentY, { width: colWidth - 20 });
      }
      
      doc.y = partiesStartY + 130;
      doc.moveDown(2);

      // ============================================
      // SECTION 2: DÉTAILS DE LA MISSION
      // ============================================
      const missionStartY = doc.y;
      
      doc.fontSize(16)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("DÉTAILS DE LA MISSION", 50, missionStartY);
      
      doc.moveTo(50, missionStartY + 20)
        .lineTo(545, missionStartY + 20)
        .strokeColor("#000000")
        .lineWidth(2)
        .stroke();
      
      doc.moveDown(1.5);
      const missionBoxY = doc.y;
      
      // Boîte pour les détails de la mission
      doc.rect(50, missionBoxY, 495, 180)
        .fill("#FAFAFA")
        .strokeColor("#DDDDDD")
        .lineWidth(1)
        .stroke();
      
      doc.fontSize(10)
        .font("Helvetica")
        .fillColor("#333333");
      
      let missionY = missionBoxY + 15;
      const lineHeight = 18;
      const leftMargin = 60;
      const labelWidth = 150;
      const valueWidth = 320;
      
      // Titre
      doc.font("Helvetica-Bold")
        .text("Titre:", leftMargin, missionY, { width: labelWidth });
      doc.font("Helvetica")
        .text(agreement.title || "Mission", leftMargin + labelWidth, missionY, { width: valueWidth });
      missionY += lineHeight;
      
      // Description
      if (agreement.description) {
        doc.font("Helvetica-Bold")
          .text("Description:", leftMargin, missionY, { width: labelWidth });
        const descLines = doc.font("Helvetica").text(agreement.description, leftMargin + labelWidth, missionY, { 
          width: valueWidth,
          lineGap: 2
        });
        missionY += (descLines.length * lineHeight) || lineHeight;
      }
      
      // Catégories
      if (agreement.categories && agreement.categories.length > 0) {
        doc.font("Helvetica-Bold")
          .text("Catégories:", leftMargin, missionY, { width: labelWidth });
        doc.font("Helvetica")
          .text(agreement.categories.join(", "), leftMargin + labelWidth, missionY, { width: valueWidth });
        missionY += lineHeight;
      }
      
      // Type de mission
      if (agreement.missionType) {
        const typeLabel = agreement.missionType === "one-time" ? "Ponctuelle" : 
                         agreement.missionType === "recurring" ? "Récurrente" : "Long terme";
        doc.font("Helvetica-Bold")
          .text("Type:", leftMargin, missionY, { width: labelWidth });
        doc.font("Helvetica")
          .text(typeLabel, leftMargin + labelWidth, missionY, { width: valueWidth });
        missionY += lineHeight;
      }
      
      // Localisation
      if (agreement.locationCity || agreement.locationPostalCode) {
        doc.font("Helvetica-Bold")
          .text("Localisation:", leftMargin, missionY, { width: labelWidth });
        doc.font("Helvetica")
          .text(`${agreement.locationCity || ""} ${agreement.locationPostalCode || ""}`.trim(), leftMargin + labelWidth, missionY, { width: valueWidth });
        missionY += lineHeight;
      }
      
      // Nombre de véhicules
      doc.font("Helvetica-Bold")
        .text("Nombre de véhicules:", leftMargin, missionY, { width: labelWidth });
      doc.font("Helvetica")
        .text(`${agreement.vehicleCount || 0}`, leftMargin + labelWidth, missionY, { width: valueWidth });
      missionY += lineHeight;
      
      // Dates
      if (agreement.startDate) {
        doc.font("Helvetica-Bold")
          .text("Date de début:", leftMargin, missionY, { width: labelWidth });
        doc.font("Helvetica")
          .text(formatDate(agreement.startDate), leftMargin + labelWidth, missionY, { width: valueWidth });
        missionY += lineHeight;
      }
      
      if (agreement.endDate) {
        doc.font("Helvetica-Bold")
          .text("Date de fin:", leftMargin, missionY, { width: labelWidth });
        doc.font("Helvetica")
          .text(formatDate(agreement.endDate), leftMargin + labelWidth, missionY, { width: valueWidth });
        missionY += lineHeight;
      }
      
      if (agreement.estimatedDurationDays) {
        doc.font("Helvetica-Bold")
          .text("Durée estimée:", leftMargin, missionY, { width: labelWidth });
        doc.font("Helvetica")
          .text(`${agreement.estimatedDurationDays} jours`, leftMargin + labelWidth, missionY, { width: valueWidth });
        missionY += lineHeight;
      }
      
      // Statut
      doc.font("Helvetica-Bold")
        .text("Statut:", leftMargin, missionY, { width: labelWidth });
      doc.font("Helvetica")
        .text(agreement.status || "draft", leftMargin + labelWidth, missionY, { width: valueWidth });
      
      doc.y = missionBoxY + 195;
      doc.moveDown(2);

      // ============================================
      // SECTION 3: MONTANTS ET PAIEMENTS
      // ============================================
      const amountsStartY = doc.y;
      
      doc.fontSize(16)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("MONTANTS ET PAIEMENTS", 50, amountsStartY);
      
      doc.moveTo(50, amountsStartY + 20)
        .lineTo(545, amountsStartY + 20)
        .strokeColor("#000000")
        .lineWidth(2)
        .stroke();
      
      doc.moveDown(1.5);
      
      // Tableau des montants
      const tableStartY = doc.y;
      const tableRowHeight = 25;
      const col1Width = 300;
      const col2Width = 195;
      
      // En-tête du tableau
      doc.rect(50, tableStartY, col1Width, tableRowHeight)
        .fill("#000000")
        .stroke();
      doc.rect(350, tableStartY, col2Width, tableRowHeight)
        .fill("#000000")
        .stroke();
      
      doc.fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#FFFFFF")
        .text("Description", 55, tableStartY + 8, { width: col1Width - 10 });
      doc.text("Montant (€)", 355, tableStartY + 8, { width: col2Width - 10, align: "right" });
      
      doc.fillColor("#000000");
      let currentTableY = tableStartY + tableRowHeight;
      
      // Ligne 1: Montant total
      doc.rect(50, currentTableY, col1Width, tableRowHeight)
        .fill("#FFFFFF")
        .stroke();
      doc.rect(350, currentTableY, col2Width, tableRowHeight)
        .fill("#FFFFFF")
        .stroke();
      doc.fontSize(10)
        .font("Helvetica")
        .text("Montant total de la mission", 55, currentTableY + 8, { width: col1Width - 10 });
      doc.font("Helvetica-Bold")
        .text(`${totalAmount.toFixed(2)}`, 355, currentTableY + 8, { width: col2Width - 10, align: "right" });
      currentTableY += tableRowHeight;
      
      // Ligne 2: Acompte
      doc.rect(50, currentTableY, col1Width, tableRowHeight)
        .fill("#F9F9F9")
        .stroke();
      doc.rect(350, currentTableY, col2Width, tableRowHeight)
        .fill("#F9F9F9")
        .stroke();
      doc.font("Helvetica")
        .text(`Acompte (${agreement.depositPercentage || 0}%)`, 55, currentTableY + 8, { width: col1Width - 10 });
      doc.text(`${depositAmount.toFixed(2)}`, 355, currentTableY + 8, { width: col2Width - 10, align: "right" });
      currentTableY += tableRowHeight;
      
      // Ligne 3: Solde restant
      doc.rect(50, currentTableY, col1Width, tableRowHeight)
        .fill("#FFFFFF")
        .stroke();
      doc.rect(350, currentTableY, col2Width, tableRowHeight)
        .fill("#FFFFFF")
        .stroke();
      doc.text("Solde restant", 55, currentTableY + 8, { width: col1Width - 10 });
      doc.text(`${remainingAmount.toFixed(2)}`, 355, currentTableY + 8, { width: col2Width - 10, align: "right" });
      currentTableY += tableRowHeight;
      
      // Ligne totale (bordure épaisse)
      doc.rect(50, currentTableY, col1Width, tableRowHeight)
        .fill("#000000")
        .stroke();
      doc.rect(350, currentTableY, col2Width, tableRowHeight)
        .fill("#000000")
        .stroke();
      doc.fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#FFFFFF")
        .text("TOTAL", 55, currentTableY + 8, { width: col1Width - 10 });
      doc.text(`${totalAmount.toFixed(2)}`, 355, currentTableY + 8, { width: col2Width - 10, align: "right" });
      currentTableY += tableRowHeight + 10;
      
      // Commission NIOS (boîte séparée)
      doc.fillColor("#000000");
      const commissionBoxY = currentTableY;
      doc.rect(50, commissionBoxY, 495, 80)
        .fill("#FFF9E6")
        .strokeColor("#FFA500")
        .lineWidth(2)
        .stroke();
      
      doc.fontSize(12)
        .font("Helvetica-Bold")
        .text("COMMISSION NIOS", 60, commissionBoxY + 10);
      
      doc.fontSize(10)
        .font("Helvetica");
      
      const commissionY = commissionBoxY + 30;
      doc.text(`Montant brut: ${totalAmount.toFixed(2)} €`, 60, commissionY);
      doc.text(`Commission (${(MISSION_COMMISSION_RATE * 100).toFixed(0)}%): ${commissionAmount.toFixed(2)} €`, 60, commissionY + 18);
      doc.fontSize(11)
        .font("Helvetica-Bold")
        .text(`Montant net pour le detailer: ${netAmount.toFixed(2)} €`, 60, commissionY + 36);
      
      doc.y = commissionBoxY + 90;
      doc.moveDown(2);

      // ============================================
      // SECTION 4: PLANNING DE PAIEMENT
      // ============================================
      if (payments && payments.length > 0) {
        const paymentStartY = doc.y;
        
        doc.fontSize(16)
          .font("Helvetica-Bold")
          .fillColor("#000000")
          .text("PLANNING DE PAIEMENT", 50, paymentStartY);
        
        doc.moveTo(50, paymentStartY + 20)
          .lineTo(545, paymentStartY + 20)
          .strokeColor("#000000")
          .lineWidth(2)
          .stroke();
        
        doc.moveDown(1.5);
        
        // Tableau des paiements
        const paymentTableY = doc.y;
        const paymentRowHeight = 30;
        const pCol1Width = 200;
        const pCol2Width = 120;
        const pCol3Width = 100;
        const pCol4Width = 75;
        
        // En-tête
        doc.rect(50, paymentTableY, pCol1Width, paymentRowHeight)
          .fill("#000000")
          .stroke();
        doc.rect(250, paymentTableY, pCol2Width, paymentRowHeight)
          .fill("#000000")
          .stroke();
        doc.rect(370, paymentTableY, pCol3Width, paymentRowHeight)
          .fill("#000000")
          .stroke();
        doc.rect(470, paymentTableY, pCol4Width, paymentRowHeight)
          .fill("#000000")
          .stroke();
        
        doc.fontSize(10)
          .font("Helvetica-Bold")
          .fillColor("#FFFFFF")
          .text("Type", 55, paymentTableY + 10, { width: pCol1Width - 10 });
        doc.text("Date", 255, paymentTableY + 10, { width: pCol2Width - 10 });
        doc.text("Montant", 375, paymentTableY + 10, { width: pCol3Width - 10, align: "right" });
        doc.text("Statut", 475, paymentTableY + 10, { width: pCol4Width - 10 });
        
        doc.fillColor("#000000");
        let currentPaymentY = paymentTableY + paymentRowHeight;
        
        payments.forEach((payment, index) => {
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
          
          // Alterner les couleurs de fond
          const bgColor = index % 2 === 0 ? "#FFFFFF" : "#F9F9F9";
          
          doc.rect(50, currentPaymentY, pCol1Width, paymentRowHeight)
            .fill(bgColor)
            .stroke();
          doc.rect(250, currentPaymentY, pCol2Width, paymentRowHeight)
            .fill(bgColor)
            .stroke();
          doc.rect(370, currentPaymentY, pCol3Width, paymentRowHeight)
            .fill(bgColor)
            .stroke();
          doc.rect(470, currentPaymentY, pCol4Width, paymentRowHeight)
            .fill(bgColor)
            .stroke();
          
          doc.fontSize(9)
            .font("Helvetica")
            .fillColor("#333333")
            .text(title, 55, currentPaymentY + 10, { width: pCol1Width - 10 });
          doc.text(scheduledDate, 255, currentPaymentY + 10, { width: pCol2Width - 10 });
          doc.font("Helvetica-Bold")
            .text(`${amount} €`, 375, currentPaymentY + 10, { width: pCol3Width - 10, align: "right" });
          doc.font("Helvetica")
            .fontSize(8)
            .text(statusLabel, 475, currentPaymentY + 10, { width: pCol4Width - 10 });
          
          currentPaymentY += paymentRowHeight;
        });
        
        doc.y = currentPaymentY + 10;
        doc.moveDown(2);
      }

      // ============================================
      // FOOTER PROFESSIONNEL
      // ============================================
      const footerY = 750;
      doc.moveTo(50, footerY)
        .lineTo(545, footerY)
        .strokeColor("#CCCCCC")
        .lineWidth(1)
        .stroke();
      
      doc.fontSize(8)
        .font("Helvetica")
        .fillColor("#666666")
        .text(
          `Document généré automatiquement par NIOS le ${formatDate(new Date().toISOString())}`,
          50,
          footerY + 10,
          { width: 495, align: "center" }
        );
      doc.text(
        "Ce document constitue un accord contractuel entre les parties mentionnées ci-dessus.",
        50,
        footerY + 25,
        { width: 495, align: "center" }
      );

      doc.end();
    } catch (error) {
      reject(new Error(`Failed to generate PDF with pdfkit: ${error.message}`));
    }
  });
}
