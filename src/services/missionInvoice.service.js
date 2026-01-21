// src/services/missionInvoice.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * DB → DTO (iOS Mission Invoice)
 */
function mapMissionInvoiceRowToDto(row) {
  if (!row) return null;

  return {
    id: row.id,
    missionAgreementId: row.mission_agreement_id,
    missionPaymentId: row.mission_payment_id,
    type: row.type, // company_invoice, detailer_invoice
    totalAmount: row.total_amount ? Number(row.total_amount) : null,
    commissionAmount: row.commission_amount ? Number(row.commission_amount) : null,
    netAmount: row.net_amount ? Number(row.net_amount) : null,
    vatAmount: row.vat_amount ? Number(row.vat_amount) : null,
    vatRate: row.vat_rate ? Number(row.vat_rate) : null,
    invoiceNumber: row.invoice_number,
    invoicePdfUrl: row.invoice_pdf_url,
    sentAt: row.sent_at,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 🟦 GENERATE INVOICE NUMBER – Générer un numéro de facture unique
 * Format : INV-YYYY-MM-XXXXX
 */
async function generateInvoiceNumber() {
  // Utiliser la fonction SQL créée dans la migration
  const { data, error } = await supabase.rpc("generate_invoice_number");

  if (error) {
    console.error("[MISSION INVOICE] Error generating invoice number:", error);
    // Fallback manuel si la fonction RPC n'existe pas
    const yearMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const { data: lastInvoice } = await supabase
      .from("mission_invoices")
      .select("invoice_number")
      .like("invoice_number", `INV-${yearMonth}-%`)
      .order("invoice_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    let sequenceNum = 1;
    if (lastInvoice) {
      const lastNum = parseInt(lastInvoice.invoice_number.slice(-5), 10);
      sequenceNum = lastNum + 1;
    }

    return `INV-${yearMonth}-${String(sequenceNum).padStart(5, "0")}`;
  }

  return data;
}

/**
 * 🟦 CREATE COMPANY INVOICE – Créer une facture pour la company (NIOS → company)
 * 
 * @param {Object} params
 * @param {string} params.missionAgreementId - ID du Mission Agreement
 * @param {string} params.missionPaymentId - ID du paiement associé (optionnel)
 * @param {number} params.totalAmount - Montant total HT
 * @param {number} params.vatRate - Taux TVA (ex: 21.00 pour 21%)
 * @param {string} params.pdfUrl - URL du PDF facture
 */
export async function createCompanyInvoice({
  missionAgreementId,
  missionPaymentId = null,
  totalAmount,
  vatRate = 21.0, // TVA belge par défaut
  pdfUrl,
}) {
  const vatAmount = Math.round((totalAmount * vatRate) / 100 * 100) / 100;
  const invoiceNumber = await generateInvoiceNumber();

  const insertPayload = {
    mission_agreement_id: missionAgreementId,
    mission_payment_id: missionPaymentId,
    type: "company_invoice",
    total_amount: totalAmount,
    commission_amount: 0, // Pas de commission pour la company (c'est elle qui paie)
    net_amount: totalAmount,
    vat_amount: vatAmount,
    vat_rate: vatRate,
    invoice_number: invoiceNumber,
    invoice_pdf_url: pdfUrl,
  };

  const { data, error } = await supabase
    .from("mission_invoices")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    console.error("[MISSION INVOICE] Insert error (company):", error);
    throw error;
  }

  console.log("✅ [MISSION INVOICE] Created company invoice:", invoiceNumber);
  return mapMissionInvoiceRowToDto(data);
}

/**
 * 🟦 CREATE DETAILER INVOICE – Créer une facture de reversement pour le detailer
 * 
 * @param {Object} params
 * @param {string} params.missionAgreementId - ID du Mission Agreement
 * @param {string} params.missionPaymentId - ID du paiement associé (optionnel)
 * @param {number} params.totalAmount - Montant total avant commission
 * @param {number} params.commissionRate - Taux de commission NIOS (ex: 0.07 pour 7%)
 * @param {string} params.pdfUrl - URL du PDF facture
 */
export async function createDetailerInvoice({
  missionAgreementId,
  missionPaymentId = null,
  totalAmount,
  commissionRate = 0.07, // 7% par défaut
  pdfUrl,
}) {
  const commissionAmount = Math.round(totalAmount * commissionRate * 100) / 100;
  const netAmount = Math.round((totalAmount - commissionAmount) * 100) / 100;
  const invoiceNumber = await generateInvoiceNumber();

  const insertPayload = {
    mission_agreement_id: missionAgreementId,
    mission_payment_id: missionPaymentId,
    type: "detailer_invoice",
    total_amount: totalAmount,
    commission_amount: commissionAmount,
    net_amount: netAmount,
    vat_amount: 0, // Pas de TVA sur le reversement (déjà facturé à la company)
    vat_rate: 0,
    invoice_number: invoiceNumber,
    invoice_pdf_url: pdfUrl,
  };

  const { data, error } = await supabase
    .from("mission_invoices")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    console.error("[MISSION INVOICE] Insert error (detailer):", error);
    throw error;
  }

  console.log("✅ [MISSION INVOICE] Created detailer invoice:", invoiceNumber);
  return mapMissionInvoiceRowToDto(data);
}

/**
 * 🟦 GET BY ID – Récupérer une facture par ID
 */
export async function getMissionInvoiceById(id) {
  const { data, error } = await supabase
    .from("mission_invoices")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    throw error;
  }

  return mapMissionInvoiceRowToDto(data);
}

/**
 * 🟦 GET FOR MISSION – Récupérer toutes les factures d'une mission
 */
export async function getMissionInvoicesForAgreement(missionAgreementId) {
  const { data, error } = await supabase
    .from("mission_invoices")
    .select("*")
    .eq("mission_agreement_id", missionAgreementId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data.map(mapMissionInvoiceRowToDto);
}

/**
 * 🟦 MARK AS SENT – Marquer une facture comme envoyée
 */
export async function markInvoiceAsSent(invoiceId) {
  const { data, error } = await supabase
    .from("mission_invoices")
    .update({
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .select("*")
    .single();

  if (error) throw error;

  return mapMissionInvoiceRowToDto(data);
}

/**
 * 🟦 MARK AS PAID – Marquer une facture comme payée
 */
export async function markInvoiceAsPaid(invoiceId) {
  const { data, error } = await supabase
    .from("mission_invoices")
    .update({
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .select("*")
    .single();

  if (error) throw error;

  return mapMissionInvoiceRowToDto(data);
}

/**
 * 🟦 GET BY INVOICE NUMBER – Trouver une facture par numéro
 */
export async function getMissionInvoiceByNumber(invoiceNumber) {
  const { data, error } = await supabase
    .from("mission_invoices")
    .select("*")
    .eq("invoice_number", invoiceNumber)
    .maybeSingle();

  if (error) throw error;

  return data ? mapMissionInvoiceRowToDto(data) : null;
}
