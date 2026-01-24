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

      // Header
      doc.fontSize(20).text("Mission Agreement", { align: "center" });
      doc.fontSize(10).text("Contrat de mission NIOS", { align: "center" });
      doc.fontSize(8).text(`Référence: ${agreement.id}`, { align: "center" });
      doc.moveDown(2);

      // Informations générales
      doc.fontSize(14).text("Informations générales", { underline: true });
      doc.moveDown();

      // Company
      doc.fontSize(12).text("Entreprise (Client)", { underline: true });
      doc.fontSize(10);
      doc.text(`Nom: ${agreement.companyLegalName || companyProfile?.legal_name || companyUser?.email || "Non défini"}`);
      if (agreement.companyVatNumber) doc.text(`TVA: ${agreement.companyVatNumber}`);
      if (agreement.companyRepresentative) doc.text(`Représentant: ${agreement.companyRepresentative}`);
      if (agreement.companyAddress) doc.text(`Adresse: ${agreement.companyAddress}`);
      if (agreement.companyEmail) doc.text(`Email: ${agreement.companyEmail}`);
      doc.moveDown();

      // Detailer
      doc.fontSize(12).text("Detailer (Prestataire)", { underline: true });
      doc.fontSize(10);
      doc.text(`Nom: ${agreement.detailerLegalName || detailerProfile?.display_name || detailerUser?.email || "Non défini"}`);
      if (agreement.detailerVatNumber) doc.text(`TVA: ${agreement.detailerVatNumber}`);
      if (agreement.detailerAddress) doc.text(`Adresse: ${agreement.detailerAddress}`);
      if (agreement.detailerEmail) doc.text(`Email: ${agreement.detailerEmail}`);
      if (agreement.detailerIban) {
        const maskedIban = `****${agreement.detailerIban.slice(-4)}`;
        doc.text(`IBAN: ${maskedIban}`);
      }
      doc.moveDown(2);

      // Détails de la mission
      doc.fontSize(14).text("Détails de la mission", { underline: true });
      doc.moveDown();
      doc.fontSize(10);
      doc.text(`Titre: ${agreement.title || "Mission"}`);
      if (agreement.description) doc.text(`Description: ${agreement.description}`);
      if (agreement.categories && agreement.categories.length > 0) {
        doc.text(`Catégories: ${agreement.categories.join(", ")}`);
      }
      if (agreement.missionType) {
        const typeLabel = agreement.missionType === "one-time" ? "Ponctuelle" : 
                         agreement.missionType === "recurring" ? "Récurrente" : "Long terme";
        doc.text(`Type de mission: ${typeLabel}`);
      }
      if (agreement.locationCity || agreement.locationPostalCode) {
        doc.text(`Localisation: ${agreement.locationCity || ""} ${agreement.locationPostalCode || ""}`);
      }
      doc.text(`Nombre de véhicules: ${agreement.vehicleCount || 0}`);
      if (agreement.startDate) doc.text(`Date de début: ${formatDate(agreement.startDate)}`);
      if (agreement.endDate) doc.text(`Date de fin: ${formatDate(agreement.endDate)}`);
      if (agreement.estimatedDurationDays) doc.text(`Durée estimée: ${agreement.estimatedDurationDays} jours`);
      if (agreement.companyAcceptedAt) doc.text(`Accepté par la company: ${formatDate(agreement.companyAcceptedAt)}`);
      if (agreement.detailerAcceptedAt) doc.text(`Accepté par le detailer: ${formatDate(agreement.detailerAcceptedAt)}`);
      doc.text(`Statut: ${agreement.status || "draft"}`);
      if (agreement.contractVersion) doc.text(`Version du contrat: ${agreement.contractVersion}`);
      doc.moveDown(2);

      // Montants et paiements
      doc.fontSize(14).text("Montants et paiements", { underline: true });
      doc.moveDown();
      doc.fontSize(10);
      doc.text(`Montant total de la mission: ${totalAmount.toFixed(2)} €`);
      doc.text(`Acompte (${agreement.depositPercentage || 0}%): ${depositAmount.toFixed(2)} €`);
      doc.text(`Solde restant: ${remainingAmount.toFixed(2)} €`);
      doc.moveDown();
      doc.fontSize(12).text("Commission NIOS", { underline: true });
      doc.fontSize(10);
      doc.text(`Montant brut: ${totalAmount.toFixed(2)} €`);
      doc.text(`Commission (${(MISSION_COMMISSION_RATE * 100).toFixed(0)}%): ${commissionAmount.toFixed(2)} €`);
      doc.fontSize(11).text(`Montant net pour le detailer: ${netAmount.toFixed(2)} €`, { bold: true });
      doc.moveDown(2);

      // Planning de paiement
      if (payments && payments.length > 0) {
        doc.fontSize(14).text("Planning de paiement", { underline: true });
        doc.moveDown();
        doc.fontSize(10);
        
        payments.forEach((payment) => {
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
          
          doc.text(`${title}: ${amount} € - ${scheduledDate} - ${statusLabel}`);
          doc.moveDown(0.5);
        });
      }

      // Footer
      doc.moveDown(3);
      doc.fontSize(8).text(
        `Document généré automatiquement par NIOS le ${formatDate(new Date().toISOString())}`,
        { align: "center" }
      );
      doc.text(
        "Ce document constitue un accord contractuel entre les parties mentionnées ci-dessus.",
        { align: "center" }
      );

      doc.end();
    } catch (error) {
      reject(new Error(`Failed to generate PDF with pdfkit: ${error.message}`));
    }
  });
}
