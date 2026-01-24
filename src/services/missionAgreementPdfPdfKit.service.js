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
      // Optimiser pour une page complète A4
      const doc = new PDFDocument({ 
        size: "A4", 
        margin: 40, // Marges réduites pour plus d'espace
        autoFirstPage: true
      });
      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Fonction helper pour vérifier et créer une nouvelle page si nécessaire
      // A4: 842 points de hauteur, marges 40 = zone utilisable ~762 points
      const checkPageBreak = (requiredHeight = 50) => {
        if (doc.y + requiredHeight > 762) {
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
        doc.moveTo(40, y)
          .lineTo(555, y)
          .strokeColor(color)
          .lineWidth(width)
          .stroke();
      };

      // ============================================
      // HEADER PROFESSIONNEL
      // ============================================
      const headerY = 40;
      const headerHeight = 70; // Réduit de 80 à 70
      drawBox(40, headerY, 515, headerHeight, "#000000", "#000000", 0);
      
      doc.fillColor("#FFFFFF")
        .fontSize(22) // Réduit de 24 à 22
        .font("Helvetica-Bold")
        .text("MISSION AGREEMENT", 40, headerY + 18, { width: 515, align: "center" });
      
      doc.fontSize(11) // Réduit de 12 à 11
        .font("Helvetica")
        .text("Contrat de mission NIOS", 40, headerY + 42, { width: 515, align: "center" });
      
      doc.fillColor("#000000");
      
      // Référence du contrat
      doc.fontSize(8) // Réduit de 9 à 8
        .fillColor("#666666")
        .text(`Référence: ${agreement.id.substring(0, 36)}...`, 40, headerY + 62, { width: 515, align: "right" });
      
      doc.fillColor("#000000");
      doc.y = headerY + headerHeight + 10;
      doc.moveDown(1.5); // Réduit de 2 à 1.5

      // ============================================
      // SECTION 1: PARTIES AU CONTRAT
      // ============================================
      checkPageBreak(180);
      
      // Titre de section
      doc.fontSize(14) // Réduit de 16 à 14
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("PARTIES AU CONTRAT");
      
      // Ligne de séparation
      drawSeparator(doc.y + 4, "#000000", 2);
      
      doc.moveDown(1.5); // Réduit de 2 à 1.5
      
      const partiesStartY = doc.y;
      const leftColX = 40;
      const rightColX = 307;
      const colWidth = 247;
      const boxHeight = 110; // Réduit de 130 à 110
      
      // Colonne gauche - Company
      drawBox(leftColX, partiesStartY, colWidth, boxHeight, "#F5F5F5", "#CCCCCC", 1);
      
      doc.fontSize(11) // Réduit de 12 à 11
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("ENTREPRISE (CLIENT)", leftColX + 8, partiesStartY + 8, { width: colWidth - 16 });
      
      doc.fontSize(9) // Réduit de 10 à 9
        .font("Helvetica")
        .fillColor("#333333");
      
      const companyName = agreement.companyLegalName || companyProfile?.legal_name || companyUser?.email || "Non défini";
      let textY = partiesStartY + 24; // Réduit de 30 à 24
      doc.text(companyName, leftColX + 8, textY, { width: colWidth - 16 });
      
      textY += 16; // Réduit de 20 à 16
      if (agreement.companyVatNumber) {
        doc.text(`TVA: ${agreement.companyVatNumber}`, leftColX + 8, textY, { width: colWidth - 16 });
        textY += 13; // Réduit de 15 à 13
      }
      if (agreement.companyRepresentative) {
        doc.text(`Représentant: ${agreement.companyRepresentative}`, leftColX + 8, textY, { width: colWidth - 16 });
        textY += 13;
      }
      if (agreement.companyAddress) {
        doc.text(`Adresse: ${agreement.companyAddress}`, leftColX + 8, textY, { width: colWidth - 16 });
        textY += 13;
      }
      if (agreement.companyEmail) {
        doc.text(`Email: ${agreement.companyEmail}`, leftColX + 8, textY, { width: colWidth - 16 });
      }
      
      // Colonne droite - Detailer
      drawBox(rightColX, partiesStartY, colWidth, boxHeight, "#F5F5F5", "#CCCCCC", 1);
      
      doc.fontSize(11) // Réduit de 12 à 11
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("DETAILER (PRESTATAIRE)", rightColX + 8, partiesStartY + 8, { width: colWidth - 16 });
      
      doc.fontSize(9) // Réduit de 10 à 9
        .font("Helvetica")
        .fillColor("#333333");
      
      const detailerName = agreement.detailerLegalName || detailerProfile?.display_name || detailerUser?.email || "Non défini";
      textY = partiesStartY + 24; // Réduit de 30 à 24
      doc.text(detailerName, rightColX + 8, textY, { width: colWidth - 16 });
      
      textY += 16; // Réduit de 20 à 16
      if (agreement.detailerVatNumber) {
        doc.text(`TVA: ${agreement.detailerVatNumber}`, rightColX + 8, textY, { width: colWidth - 16 });
        textY += 13; // Réduit de 15 à 13
      }
      if (agreement.detailerAddress) {
        doc.text(`Adresse: ${agreement.detailerAddress}`, rightColX + 8, textY, { width: colWidth - 16 });
        textY += 13;
      }
      if (agreement.detailerEmail) {
        doc.text(`Email: ${agreement.detailerEmail}`, rightColX + 8, textY, { width: colWidth - 16 });
        textY += 13;
      }
      if (agreement.detailerIban) {
        const maskedIban = `****${agreement.detailerIban.slice(-4)}`;
        doc.text(`IBAN: ${maskedIban}`, rightColX + 8, textY, { width: colWidth - 16 });
      }
      
      doc.y = partiesStartY + boxHeight + 8;
      doc.moveDown(1.5); // Réduit de 2 à 1.5

      // ============================================
      // SECTION 2: DÉTAILS DE LA MISSION
      // ============================================
      checkPageBreak(200);
      
      doc.fontSize(14) // Réduit de 16 à 14
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("DÉTAILS DE LA MISSION");
      
      drawSeparator(doc.y + 4, "#000000", 2);
      
      doc.moveDown(1.5); // Réduit de 2 à 1.5
      
      const missionBoxY = doc.y;
      const leftMargin = 50;
      const labelWidth = 140;
      const valueWidth = 325;
      let missionY = missionBoxY + 12; // Réduit de 15 à 12
      const lineHeight = 15; // Réduit de 18 à 15
      
      // Calculer la hauteur nécessaire (optimisé)
      let contentHeight = 12; // Padding top réduit
      contentHeight += lineHeight; // Titre
      if (agreement.description) contentHeight += lineHeight * 1.5; // Description optimisée
      if (agreement.categories && agreement.categories.length > 0) contentHeight += lineHeight;
      if (agreement.missionType) contentHeight += lineHeight;
      if (agreement.locationCity || agreement.locationPostalCode) contentHeight += lineHeight;
      contentHeight += lineHeight; // Nombre de véhicules
      if (agreement.startDate) contentHeight += lineHeight;
      if (agreement.endDate) contentHeight += lineHeight;
      if (agreement.estimatedDurationDays) contentHeight += lineHeight;
      contentHeight += lineHeight; // Statut
      contentHeight += 12; // Padding bottom réduit
      
      // Boîte pour les détails de la mission
      drawBox(40, missionBoxY, 515, contentHeight, "#FAFAFA", "#DDDDDD", 1);
      
      doc.fontSize(9) // Réduit de 10 à 9
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
      checkPageBreak(200);
      
      doc.fontSize(14) // Réduit de 16 à 14
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("MONTANTS ET PAIEMENTS");
      
      drawSeparator(doc.y + 4, "#000000", 2);
      
      doc.moveDown(1.5); // Réduit de 2 à 1.5
      
      // Tableau des montants
      const tableStartY = doc.y;
      const tableRowHeight = 24; // Réduit de 28 à 24
      const col1Width = 310;
      const col2Width = 205;
      
      // En-tête du tableau
      drawBox(40, tableStartY, col1Width, tableRowHeight, "#000000", "#000000", 0);
      drawBox(350, tableStartY, col2Width, tableRowHeight, "#000000", "#000000", 0);
      
      doc.fontSize(10) // Réduit de 11 à 10
        .font("Helvetica-Bold")
        .fillColor("#FFFFFF")
        .text("Description", 45, tableStartY + 7, { width: col1Width - 10 });
      doc.text("Montant (€)", 355, tableStartY + 7, { width: col2Width - 10, align: "right" });
      
      doc.fillColor("#000000");
      let currentTableY = tableStartY + tableRowHeight;
      
      // Ligne 1: Montant total
      drawBox(40, currentTableY, col1Width, tableRowHeight, "#FFFFFF", "#DDDDDD", 1);
      drawBox(350, currentTableY, col2Width, tableRowHeight, "#FFFFFF", "#DDDDDD", 1);
      doc.fontSize(9) // Réduit de 10 à 9
        .font("Helvetica")
        .fillColor("#333333")
        .text("Montant total de la mission", 45, currentTableY + 7, { width: col1Width - 10 });
      doc.font("Helvetica-Bold")
        .fillColor("#000000")
        .text(`${totalAmount.toFixed(2)}`, 355, currentTableY + 7, { width: col2Width - 10, align: "right" });
      currentTableY += tableRowHeight;
      
      // Ligne 2: Acompte
      drawBox(40, currentTableY, col1Width, tableRowHeight, "#F9F9F9", "#DDDDDD", 1);
      drawBox(350, currentTableY, col2Width, tableRowHeight, "#F9F9F9", "#DDDDDD", 1);
      doc.font("Helvetica")
        .fillColor("#333333")
        .text(`Acompte (${agreement.depositPercentage || 0}%)`, 45, currentTableY + 7, { width: col1Width - 10 });
      doc.text(`${depositAmount.toFixed(2)}`, 355, currentTableY + 7, { width: col2Width - 10, align: "right" });
      currentTableY += tableRowHeight;
      
      // Ligne 3: Solde restant
      drawBox(40, currentTableY, col1Width, tableRowHeight, "#FFFFFF", "#DDDDDD", 1);
      drawBox(350, currentTableY, col2Width, tableRowHeight, "#FFFFFF", "#DDDDDD", 1);
      doc.text("Solde restant", 45, currentTableY + 7, { width: col1Width - 10 });
      doc.text(`${remainingAmount.toFixed(2)}`, 355, currentTableY + 7, { width: col2Width - 10, align: "right" });
      currentTableY += tableRowHeight;
      
      // Ligne totale (bordure épaisse)
      drawBox(40, currentTableY, col1Width, tableRowHeight, "#000000", "#000000", 0);
      drawBox(350, currentTableY, col2Width, tableRowHeight, "#000000", "#000000", 0);
      doc.fontSize(10) // Réduit de 11 à 10
        .font("Helvetica-Bold")
        .fillColor("#FFFFFF")
        .text("TOTAL", 45, currentTableY + 7, { width: col1Width - 10 });
      doc.text(`${totalAmount.toFixed(2)}`, 355, currentTableY + 7, { width: col2Width - 10, align: "right" });
      currentTableY += tableRowHeight + 10; // Réduit de 15 à 10
      
      // Commission NIOS (boîte séparée)
      doc.fillColor("#000000");
      const commissionBoxY = currentTableY;
      const commissionBoxHeight = 70; // Réduit de 85 à 70
      drawBox(40, commissionBoxY, 515, commissionBoxHeight, "#FFF9E6", "#FFA500", 2);
      
      doc.fontSize(11) // Réduit de 12 à 11
        .font("Helvetica-Bold")
        .text("COMMISSION NIOS", 50, commissionBoxY + 10);
      
      doc.fontSize(9) // Réduit de 10 à 9
        .font("Helvetica")
        .fillColor("#333333");
      
      const commissionY = commissionBoxY + 26; // Réduit de 32 à 26
      doc.text(`Montant brut: ${totalAmount.toFixed(2)} €`, 50, commissionY);
      doc.text(`Commission (${(MISSION_COMMISSION_RATE * 100).toFixed(0)}%): ${commissionAmount.toFixed(2)} €`, 50, commissionY + 14); // Réduit de 18 à 14
      doc.fontSize(10) // Réduit de 11 à 10
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text(`Montant net pour le detailer: ${netAmount.toFixed(2)} €`, 50, commissionY + 28); // Réduit de 36 à 28
      
      doc.y = commissionBoxY + commissionBoxHeight + 8;
      doc.moveDown(1.5); // Réduit de 2 à 1.5

      // ============================================
      // SECTION 4: PLANNING DE PAIEMENT
      // ============================================
      if (payments && payments.length > 0) {
        checkPageBreak(80 + (payments.length * 28)); // Optimisé
        
        doc.fontSize(14) // Réduit de 16 à 14
          .font("Helvetica-Bold")
          .fillColor("#000000")
          .text("PLANNING DE PAIEMENT");
        
        drawSeparator(doc.y + 4, "#000000", 2);
        
        doc.moveDown(1.5); // Réduit de 2 à 1.5
        
        // Tableau des paiements
        const paymentTableY = doc.y;
        const paymentRowHeight = 26; // Réduit de 32 à 26
        const pCol1Width = 200;
        const pCol2Width = 120;
        const pCol3Width = 100;
        const pCol4Width = 95;
        
        // En-tête
        drawBox(40, paymentTableY, pCol1Width, paymentRowHeight, "#000000", "#000000", 0);
        drawBox(240, paymentTableY, pCol2Width, paymentRowHeight, "#000000", "#000000", 0);
        drawBox(360, paymentTableY, pCol3Width, paymentRowHeight, "#000000", "#000000", 0);
        drawBox(460, paymentTableY, pCol4Width, paymentRowHeight, "#000000", "#000000", 0);
        
        doc.fontSize(9) // Réduit de 10 à 9
          .font("Helvetica-Bold")
          .fillColor("#FFFFFF")
          .text("Type", 45, paymentTableY + 8, { width: pCol1Width - 10 });
        doc.text("Date", 245, paymentTableY + 8, { width: pCol2Width - 10 });
        doc.text("Montant", 365, paymentTableY + 8, { width: pCol3Width - 10, align: "right" });
        doc.text("Statut", 465, paymentTableY + 8, { width: pCol4Width - 10 });
        
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
          
          drawBox(40, currentPaymentY, pCol1Width, paymentRowHeight, bgColor, "#DDDDDD", 1);
          drawBox(240, currentPaymentY, pCol2Width, paymentRowHeight, bgColor, "#DDDDDD", 1);
          drawBox(360, currentPaymentY, pCol3Width, paymentRowHeight, bgColor, "#DDDDDD", 1);
          drawBox(460, currentPaymentY, pCol4Width, paymentRowHeight, bgColor, "#DDDDDD", 1);
          
          doc.fontSize(8) // Réduit de 9 à 8
            .font("Helvetica")
            .fillColor("#333333")
            .text(title, 45, currentPaymentY + 8, { width: pCol1Width - 10 });
          doc.text(scheduledDate, 245, currentPaymentY + 8, { width: pCol2Width - 10 });
          doc.font("Helvetica-Bold")
            .fillColor("#000000")
            .text(`${amount} €`, 365, currentPaymentY + 8, { width: pCol3Width - 10, align: "right" });
          doc.font("Helvetica")
            .fontSize(7) // Réduit de 8 à 7
            .fillColor("#666666")
            .text(statusLabel, 465, currentPaymentY + 8, { width: pCol4Width - 10 });
          
          currentPaymentY += paymentRowHeight;
        });
        
        doc.y = currentPaymentY + 8; // Réduit de 10 à 8
        doc.moveDown(1.5); // Réduit de 2 à 1.5
      }

      // ============================================
      // FOOTER PROFESSIONNEL
      // ============================================
      checkPageBreak(40);
      
      const footerY = Math.min(doc.y, 762);
      drawSeparator(footerY, "#CCCCCC", 1);
      
      doc.fontSize(7) // Réduit de 8 à 7
        .font("Helvetica")
        .fillColor("#666666")
        .text(
          `Document généré automatiquement par NIOS le ${formatDate(new Date().toISOString())}`,
          40,
          footerY + 8, // Réduit de 10 à 8
          { width: 515, align: "center" }
        );
      doc.text(
        "Ce document constitue un accord contractuel entre les parties mentionnées ci-dessus.",
        40,
        footerY + 20, // Réduit de 25 à 20
        { width: 515, align: "center" }
      );

      doc.end();
    } catch (error) {
      reject(new Error(`Failed to generate PDF with pdfkit: ${error.message}`));
    }
  });
}
