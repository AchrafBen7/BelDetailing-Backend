import PDFDocument from "pdfkit";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { BOOKING_COMMISSION_RATE } from "../config/commission.js";
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
  const commissions = Math.round(revenue * BOOKING_COMMISSION_RATE * 100) / 100; // 10% pour les bookings
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
 * Liste des documents (metadata) selon le rôle : provider, customer, company.
 * - Provider : factures BelDetailing + relevé Stripe + une entrée par résa payée (Stripe receipt)
 * - Customer : une entrée par résa payée (Stripe receipt)
 * - Company : une entrée par facture mission (company_invoice)
 */
export async function buildDocumentsList(userId, month, role = "provider") {
  const { start, end } = getMonthRange(month);
  const documents = [];
  const isProvider = role === "provider" || role === "provider_passionate";

  if (isProvider) {
    const summary = await computeMonthlySummary(userId, month);

    // Facture BelDetailing → seulement si commission > 0
    if (summary.commissions > 0) {
      documents.push({
        id: `${month}-beldetailing`,
        type: "belDetailingInvoice",
        title: "Facture NIOS",
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

    // Factures Stripe (reçu) par résa payée
    const { data: providerBookings } = await supabase
      .from("bookings")
      .select("id, service_name, price, receipt_url, created_at")
      .eq("provider_id", userId)
      .eq("payment_status", "paid")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });

    (providerBookings || []).forEach((b) => {
      const subtitle = b.service_name
        ? `${b.service_name} • ${month}`
        : `Réservation • ${month}`;
      documents.push({
        id: `booking-${b.id}`,
        type: "stripeReceipt",
        title: "Facture réservation",
        subtitle,
        amount: Number(b.price) || 0,
        currency: "eur",
        openUrl: b.receipt_url || null,
      });
    });
  }

  if (role === "customer") {
    const { data: customerBookings } = await supabase
      .from("bookings")
      .select("id, service_name, price, receipt_url, created_at")
      .eq("customer_id", userId)
      .eq("payment_status", "paid")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });

    (customerBookings || []).forEach((b) => {
      const subtitle = b.service_name
        ? `${b.service_name} • ${month}`
        : `Réservation • ${month}`;
      documents.push({
        id: `booking-${b.id}`,
        type: "stripeReceipt",
        title: "Facture réservation",
        subtitle,
        amount: Number(b.price) || 0,
        currency: "eur",
        openUrl: b.receipt_url || null,
      });
    });
  }

  if (role === "company") {
    const { data: rows } = await supabase
      .from("mission_invoices")
      .select("id, mission_agreement_id, invoice_number, total_amount, invoice_pdf_url, created_at")
      .eq("type", "company_invoice")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });

    if (rows && rows.length > 0) {
      const agreementIds = [...new Set(rows.map((r) => r.mission_agreement_id).filter(Boolean))];
      const { data: agreements } = await supabase
        .from("mission_agreements")
        .select("id, company_id")
        .in("id", agreementIds);

      const companyAgreementIds = new Set(
        (agreements || []).filter((a) => a.company_id === userId).map((a) => a.id)
      );

      rows.forEach((inv) => {
        if (!inv.mission_agreement_id || !companyAgreementIds.has(inv.mission_agreement_id)) return;
        documents.push({
          id: `mission-invoice-${inv.id}`,
          type: "companyInvoice",
          title: inv.invoice_number || `Facture ${inv.id}`,
          subtitle: `${month} • Facture mission`,
          amount: Number(inv.total_amount) || 0,
          currency: "eur",
          openUrl: inv.invoice_pdf_url || null,
        });
      });
    }
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

  doc.fontSize(20).text("NIOS", { align: "center" });
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
