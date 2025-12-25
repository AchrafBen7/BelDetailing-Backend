import PDFDocument from "pdfkit";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { getMonthRange } from "../utils/date.utils.js";

/**
 * Vérifie que le provider a une activité sur le mois
 */
export async function providerHasActivity(providerUserId, month) {
  const { start, end } = getMonthRange(month);


  const { data, error } = await supabase
    .from("bookings")
    .select("id")
    .eq("provider_id", providerUserId)
    .eq("payment_status", "paid")
    .gte("created_at", start)
    .lte("created_at", end)
    .limit(1);

  if (error) throw error;
  return data.length > 0;
}

/**
 * Résumé mensuel (recalcul backend)
 */
export async function computeMonthlySummary(providerUserId, month) {
  const { start, end } = getMonthRange(month);

  const { data, error } = await supabase
    .from("bookings")
    .select("price")
    .eq("provider_id", providerUserId)
    .eq("payment_status", "paid")
    .gte("created_at", start)
    .lte("created_at", end);

  if (error) throw error;

  const revenue = data.reduce((sum, b) => sum + Number(b.price), 0);
  const servicesCount = data.length;
  const commissions = Math.round(revenue * 0.10 * 100) / 100;
  const net = Math.round((revenue - commissions) * 100) / 100;

  return {
    month,
    revenue,
    servicesCount,
    commissions,
    net,
    currency: "eur",
  };
}

/**
 * Liste des documents (metadata)
 */
export async function buildDocumentsList(providerUserId, month) {
  const summary = await computeMonthlySummary(providerUserId, month);

  const documents = [];

  // Facture BelDetailing → seulement si commission > 0
  if (summary.commissions > 0) {
    documents.push({
      id: `${month}-beldetailing`,
      type: "belDetailingInvoice",
      title: "Facture BelDetailing",
      subtitle: `${month} • Commission mensuelle`,
      amount: summary.commissions,
      currency: "eur",
    });
  }

  // Relevé Stripe → seulement si revenue > 0
  if (summary.revenue > 0) {
    documents.push({
      id: `${month}-stripe`,
      type: "stripeStatement",
      title: "Relevé Stripe",
      subtitle: `${month} • Récap des paiements`,
      amount: summary.revenue,
      currency: "eur",
    });
  }

  return documents;
}


/**
 * Génération PDF à la volée
 */
export async function generateDocumentPDF(providerUserId, documentId) {
  const parts = documentId.split("-");

  if (parts.length < 3) {
    throw new Error("Invalid document id");
  }

  const month = `${parts[0]}-${parts[1]}`;
  const type = parts.slice(2).join("-");

  if (!["beldetailing", "stripe"].includes(type)) {
    throw new Error("Unsupported document type");
  }

  const summary = await computeMonthlySummary(providerUserId, month);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks = [];

  doc.on("data", c => chunks.push(c));
  doc.on("end", () => {});

  doc.fontSize(20).text("BelDetailing", { align: "center" });
  doc.moveDown();

  doc.fontSize(14).text(`Document: ${documentId}`);
  doc.text(`Période: ${month}`);
  doc.moveDown();

  if (type === "beldetailing") {
    doc.text(`Commission mensuelle: ${summary.commissions} €`);
    doc.text(`Chiffre d'affaires: ${summary.revenue} €`);
  }

  if (type === "stripe") {
    doc.text(`Total paiements: ${summary.revenue} €`);
    doc.text(`Prestations: ${summary.servicesCount}`);
  }

  doc.moveDown();
  doc.fontSize(10).text("Document généré automatiquement – à usage comptable.");

  doc.end();

  return Buffer.concat(chunks);
}
