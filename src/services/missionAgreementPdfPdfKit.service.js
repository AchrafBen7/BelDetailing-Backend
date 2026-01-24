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
 * Design professionnel avec structure claire et tableaux.
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

      // Fonction helper pour dessiner un rectangle avec bordure
      const drawBox = (x, y, width, height, fillColor, strokeColor, lineWidth = 1) => {
        doc.rect(x, y, width, height)
          .fill(fillColor)
          .strokeColor(strokeColor)
          .lineWidth(lineWidth)
          .stroke();
      };

      // Fonction helper pour dessiner une ligne de séparation
      const drawSeparator = (y, color = "#000000", width = 2) => {
        doc.moveTo(50, y)
          .lineTo(545, y)
          .strokeColor(color)
          .lineWidth(width)
          .stroke();
      };

      // ============================================
      // HEADER PROFESSIONNEL
      // ============================================
      const headerY = 50;
      drawBox(50, headerY, 495, 80, "#000000", "#000000", 0);
      
      doc.fillColor("#FFFFFF")
        .fontSize(24)
        .font("Helvetica-Bold")
        .text("MISSION AGREEMENT", 50, headerY + 20, { width: 495, align: "center" });
      
      doc.fontSize(12)
        .font("Helvetica")
        .text("Contrat de mission NIOS", 50, headerY + 50, { width: 495, align: "center" });
      
      doc.fillColor("#000000");
      
      // Référence du contrat
      doc.fontSize(9)
        .fillColor("#666666")
        .text(`Référence: ${agreement.id}`, 50, headerY + 90, { width: 495, align: "right" });
      
      doc.fillColor("#000000");
      doc.y = headerY + 100;
      doc.moveDown(2);

      // ============================================
      // SECTION 1: PARTIES AU CONTRAT
      // ============================================
      checkPageBreak(200);
      
      // Titre de section
      doc.fontSize(16)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("PARTIES AU CONTRAT");
      
      // Ligne de séparation
      drawSeparator(doc.y + 5, "#000000", 2);
      
      doc.moveDown(2);
      
      const partiesStartY = doc.y;
      const leftColX = 50;
      const rightColX = 305;
      const colWidth = 240;
      const boxHeight = 130;
      
      // Colonne gauche - Company
      drawBox(leftColX, partiesStartY, colWidth, boxHeight, "#F5F5F5", "#CCCCCC", 1);
      
      doc.fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("ENTREPRISE (CLIENT)", leftColX + 10, partiesStartY + 10, { width: colWidth - 20 });
      
      doc.fontSize(10)
        .font("Helvetica")
        .fillColor("#333333");
      
      const companyName = agreement.companyLegalName || companyProfile?.legal_name || companyUser?.email || "Non défini";
      let textY = partiesStartY + 30;
      doc.text(companyName, leftColX + 10, textY, { width: colWidth - 20 });
      
      textY += 20;
      if (agreement.companyVatNumber) {
        doc.text(`TVA: ${agreement.companyVatNumber}`, leftColX + 10, textY, { width: colWidth - 20 });
        textY += 15;
      }
      if (agreement.companyRepresentative) {
        doc.text(`Représentant: ${agreement.companyRepresentative}`, leftColX + 10, textY, { width: colWidth - 20 });
        textY += 15;
      }
      if (agreement.companyAddress) {
        doc.text(`Adresse: ${agreement.companyAddress}`, leftColX + 10, textY, { width: colWidth - 20 });
        textY += 15;
      }
      if (agreement.companyEmail) {
        doc.text(`Email: ${agreement.companyEmail}`, leftColX + 10, textY, { width: colWidth - 20 });
      }
      
      // Colonne droite - Detailer
      drawBox(rightColX, partiesStartY, colWidth, boxHeight, "#F5F5F5", "#CCCCCC", 1);
      
      doc.fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("DETAILER (PRESTATAIRE)", rightColX + 10, partiesStartY + 10, { width: colWidth - 20 });
      
      doc.fontSize(10)
        .font("Helvetica")
        .fillColor("#333333");
      
      const detailerName = agreement.detailerLegalName || detailerProfile?.display_name || detailerUser?.email || "Non défini";
      textY = partiesStartY + 30;
      doc.text(detailerName, rightColX + 10, textY, { width: colWidth - 20 });
      
      textY += 20;
      if (agreement.detailerVatNumber) {
        doc.text(`TVA: ${agreement.detailerVatNumber}`, rightColX + 10, textY, { width: colWidth - 20 });
        textY += 15;
      }
      if (agreement.detailerAddress) {
        doc.text(`Adresse: ${agreement.detailerAddress}`, rightColX + 10, textY, { width: colWidth - 20 });
        textY += 15;
      }
      if (agreement.detailerEmail) {
        doc.text(`Email: ${agreement.detailerEmail}`, rightColX + 10, textY, { width: colWidth - 20 });
        textY += 15;
      }
      if (agreement.detailerIban) {
        const maskedIban = `****${agreement.detailerIban.slice(-4)}`;
        doc.text(`IBAN: ${maskedIban}`, rightColX + 10, textY, { width: colWidth - 20 });
      }
      
      doc.y = partiesStartY + boxHeight + 10;
      doc.moveDown(2);

      // ============================================
      // SECTION 2: DÉTAILS DE LA MISSION
      // ============================================
      checkPageBreak(250);
      
      doc.fontSize(16)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("DÉTAILS DE LA MISSION");
      
      drawSeparator(doc.y + 5, "#000000", 2);
      
      doc.moveDown(2);
      
      const missionBoxY = doc.y;
      const leftMargin = 60;
      const labelWidth = 150;
      const valueWidth = 320;
      let missionY = missionBoxY + 15;
      const lineHeight = 18;
      
      // Calculer la hauteur nécessaire
      let contentHeight = 20; // Padding top
      contentHeight += lineHeight; // Titre
      if (agreement.description) contentHeight += lineHeight * 2; // Description (peut être sur plusieurs lignes)
      if (agreement.categories && agreement.categories.length > 0) contentHeight += lineHeight;
      if (agreement.missionType) contentHeight += lineHeight;
      if (agreement.locationCity || agreement.locationPostalCode) contentHeight += lineHeight;
      contentHeight += lineHeight; // Nombre de véhicules
      if (agreement.startDate) contentHeight += lineHeight;
      if (agreement.endDate) contentHeight += lineHeight;
      if (agreement.estimatedDurationDays) contentHeight += lineHeight;
      contentHeight += lineHeight; // Statut
      contentHeight += 15; // Padding bottom
      
      // Boîte pour les détails de la mission
      drawBox(50, missionBoxY, 495, contentHeight, "#FAFAFA", "#DDDDDD", 1);
      
      doc.fontSize(10)
        .font("Helvetica")
        .fillColor("#333333");
      
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
        doc.font("Helvetica")
          .text(agreement.description, leftMargin + labelWidth, missionY, { 
            width: valueWidth,
            lineGap: 2
          });
        missionY += lineHeight * 2;
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
      
      doc.y = missionBoxY + contentHeight + 10;
      doc.moveDown(2);

      // ============================================
      // SECTION 3: MONTANTS ET PAIEMENTS
      // ============================================
      checkPageBreak(250);
      
      doc.fontSize(16)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("MONTANTS ET PAIEMENTS");
      
      drawSeparator(doc.y + 5, "#000000", 2);
      
      doc.moveDown(2);
      
      // Tableau des montants
      const tableStartY = doc.y;
      const tableRowHeight = 28;
      const col1Width = 300;
      const col2Width = 195;
      
      // En-tête du tableau
      drawBox(50, tableStartY, col1Width, tableRowHeight, "#000000", "#000000", 0);
      drawBox(350, tableStartY, col2Width, tableRowHeight, "#000000", "#000000", 0);
      
      doc.fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#FFFFFF")
        .text("Description", 55, tableStartY + 9, { width: col1Width - 10 });
      doc.text("Montant (€)", 355, tableStartY + 9, { width: col2Width - 10, align: "right" });
      
      doc.fillColor("#000000");
      let currentTableY = tableStartY + tableRowHeight;
      
      // Ligne 1: Montant total
      drawBox(50, currentTableY, col1Width, tableRowHeight, "#FFFFFF", "#DDDDDD", 1);
      drawBox(350, currentTableY, col2Width, tableRowHeight, "#FFFFFF", "#DDDDDD", 1);
      doc.fontSize(10)
        .font("Helvetica")
        .fillColor("#333333")
        .text("Montant total de la mission", 55, currentTableY + 9, { width: col1Width - 10 });
      doc.font("Helvetica-Bold")
        .fillColor("#000000")
        .text(`${totalAmount.toFixed(2)}`, 355, currentTableY + 9, { width: col2Width - 10, align: "right" });
      currentTableY += tableRowHeight;
      
      // Ligne 2: Acompte
      drawBox(50, currentTableY, col1Width, tableRowHeight, "#F9F9F9", "#DDDDDD", 1);
      drawBox(350, currentTableY, col2Width, tableRowHeight, "#F9F9F9", "#DDDDDD", 1);
      doc.font("Helvetica")
        .fillColor("#333333")
        .text(`Acompte (${agreement.depositPercentage || 0}%)`, 55, currentTableY + 9, { width: col1Width - 10 });
      doc.text(`${depositAmount.toFixed(2)}`, 355, currentTableY + 9, { width: col2Width - 10, align: "right" });
      currentTableY += tableRowHeight;
      
      // Ligne 3: Solde restant
      drawBox(50, currentTableY, col1Width, tableRowHeight, "#FFFFFF", "#DDDDDD", 1);
      drawBox(350, currentTableY, col2Width, tableRowHeight, "#FFFFFF", "#DDDDDD", 1);
      doc.text("Solde restant", 55, currentTableY + 9, { width: col1Width - 10 });
      doc.text(`${remainingAmount.toFixed(2)}`, 355, currentTableY + 9, { width: col2Width - 10, align: "right" });
      currentTableY += tableRowHeight;
      
      // Ligne totale (bordure épaisse)
      drawBox(50, currentTableY, col1Width, tableRowHeight, "#000000", "#000000", 0);
      drawBox(350, currentTableY, col2Width, tableRowHeight, "#000000", "#000000", 0);
      doc.fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#FFFFFF")
        .text("TOTAL", 55, currentTableY + 9, { width: col1Width - 10 });
      doc.text(`${totalAmount.toFixed(2)}`, 355, currentTableY + 9, { width: col2Width - 10, align: "right" });
      currentTableY += tableRowHeight + 15;
      
      // Commission NIOS (boîte séparée)
      doc.fillColor("#000000");
      const commissionBoxY = currentTableY;
      const commissionBoxHeight = 85;
      drawBox(50, commissionBoxY, 495, commissionBoxHeight, "#FFF9E6", "#FFA500", 2);
      
      doc.fontSize(12)
        .font("Helvetica-Bold")
        .text("COMMISSION NIOS", 60, commissionBoxY + 12);
      
      doc.fontSize(10)
        .font("Helvetica")
        .fillColor("#333333");
      
      const commissionY = commissionBoxY + 32;
      doc.text(`Montant brut: ${totalAmount.toFixed(2)} €`, 60, commissionY);
      doc.text(`Commission (${(MISSION_COMMISSION_RATE * 100).toFixed(0)}%): ${commissionAmount.toFixed(2)} €`, 60, commissionY + 18);
      doc.fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text(`Montant net pour le detailer: ${netAmount.toFixed(2)} €`, 60, commissionY + 36);
      
      doc.y = commissionBoxY + commissionBoxHeight + 10;
      doc.moveDown(2);

      // ============================================
      // SECTION 4: PLANNING DE PAIEMENT
      // ============================================
      if (payments && payments.length > 0) {
        checkPageBreak(100 + (payments.length * 35));
        
        doc.fontSize(16)
          .font("Helvetica-Bold")
          .fillColor("#000000")
          .text("PLANNING DE PAIEMENT");
        
        drawSeparator(doc.y + 5, "#000000", 2);
        
        doc.moveDown(2);
        
        // Tableau des paiements
        const paymentTableY = doc.y;
        const paymentRowHeight = 32;
        const pCol1Width = 200;
        const pCol2Width = 120;
        const pCol3Width = 100;
        const pCol4Width = 75;
        
        // En-tête
        drawBox(50, paymentTableY, pCol1Width, paymentRowHeight, "#000000", "#000000", 0);
        drawBox(250, paymentTableY, pCol2Width, paymentRowHeight, "#000000", "#000000", 0);
        drawBox(370, paymentTableY, pCol3Width, paymentRowHeight, "#000000", "#000000", 0);
        drawBox(470, paymentTableY, pCol4Width, paymentRowHeight, "#000000", "#000000", 0);
        
        doc.fontSize(10)
          .font("Helvetica-Bold")
          .fillColor("#FFFFFF")
          .text("Type", 55, paymentTableY + 11, { width: pCol1Width - 10 });
        doc.text("Date", 255, paymentTableY + 11, { width: pCol2Width - 10 });
        doc.text("Montant", 375, paymentTableY + 11, { width: pCol3Width - 10, align: "right" });
        doc.text("Statut", 475, paymentTableY + 11, { width: pCol4Width - 10 });
        
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
          
          drawBox(50, currentPaymentY, pCol1Width, paymentRowHeight, bgColor, "#DDDDDD", 1);
          drawBox(250, currentPaymentY, pCol2Width, paymentRowHeight, bgColor, "#DDDDDD", 1);
          drawBox(370, currentPaymentY, pCol3Width, paymentRowHeight, bgColor, "#DDDDDD", 1);
          drawBox(470, currentPaymentY, pCol4Width, paymentRowHeight, bgColor, "#DDDDDD", 1);
          
          doc.fontSize(9)
            .font("Helvetica")
            .fillColor("#333333")
            .text(title, 55, currentPaymentY + 11, { width: pCol1Width - 10 });
          doc.text(scheduledDate, 255, currentPaymentY + 11, { width: pCol2Width - 10 });
          doc.font("Helvetica-Bold")
            .fillColor("#000000")
            .text(`${amount} €`, 375, currentPaymentY + 11, { width: pCol3Width - 10, align: "right" });
          doc.font("Helvetica")
            .fontSize(8)
            .fillColor("#666666")
            .text(statusLabel, 475, currentPaymentY + 11, { width: pCol4Width - 10 });
          
          currentPaymentY += paymentRowHeight;
        });
        
        doc.y = currentPaymentY + 10;
        doc.moveDown(2);
      }

      // ============================================
      // FOOTER PROFESSIONNEL
      // ============================================
      checkPageBreak(50);
      
      const footerY = Math.min(doc.y, 750);
      drawSeparator(footerY, "#CCCCCC", 1);
      
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
