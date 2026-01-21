// src/controllers/missionInvoice.controller.js
import {
  createCompanyInvoice,
  createDetailerInvoice,
  getMissionInvoiceById,
  getMissionInvoicesForAgreement,
  markInvoiceAsSent,
  markInvoiceAsPaid,
  getMissionInvoiceByNumber,
} from "../services/missionInvoice.service.js";
import { getMissionAgreementById } from "../services/missionAgreement.service.js";

/**
 * 🔹 POST /api/v1/mission-invoices/company
 * Créer une facture pour la company (NIOS → company)
 */
export async function createCompanyInvoiceController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can create company invoices" });
    }

    const { missionAgreementId, missionPaymentId, totalAmount, vatRate, pdfUrl } = req.body;

    if (!missionAgreementId || !totalAmount || !pdfUrl) {
      return res.status(400).json({ error: "Missing required fields: missionAgreementId, totalAmount, pdfUrl" });
    }

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    if (agreement.companyId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const invoice = await createCompanyInvoice({
      missionAgreementId,
      missionPaymentId,
      totalAmount,
      vatRate: vatRate || 21.0,
      pdfUrl,
    });

    return res.status(201).json({ data: invoice });
  } catch (err) {
    console.error("[MISSION INVOICE] create company error:", err);
    return res.status(500).json({ error: "Could not create company invoice" });
  }
}

/**
 * 🔹 POST /api/v1/mission-invoices/detailer
 * Créer une facture de reversement pour le detailer
 */
export async function createDetailerInvoiceController(req, res) {
  try {
    // Seulement pour admin ou système automatique
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { missionAgreementId, missionPaymentId, totalAmount, commissionRate, pdfUrl } = req.body;

    if (!missionAgreementId || !totalAmount || !pdfUrl) {
      return res.status(400).json({ error: "Missing required fields: missionAgreementId, totalAmount, pdfUrl" });
    }

    const invoice = await createDetailerInvoice({
      missionAgreementId,
      missionPaymentId,
      totalAmount,
      commissionRate: commissionRate || 0.07,
      pdfUrl,
    });

    return res.status(201).json({ data: invoice });
  } catch (err) {
    console.error("[MISSION INVOICE] create detailer error:", err);
    return res.status(500).json({ error: "Could not create detailer invoice" });
  }
}

/**
 * 🔹 GET /api/v1/mission-invoices/:id
 * Récupérer une facture par ID
 */
export async function getMissionInvoiceController(req, res) {
  try {
    const { id } = req.params;
    const invoice = await getMissionInvoiceById(id);

    if (!invoice) {
      return res.status(404).json({ error: "Mission Invoice not found" });
    }

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(invoice.missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    // Company peut voir ses factures (company_invoice)
    if (userRole === "company" && agreement.companyId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Provider peut voir ses factures de reversement (detailer_invoice)
    if (userRole === "provider" && agreement.detailerId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Admin peut voir toutes les factures
    if (userRole !== "admin" && userRole !== "company" && userRole !== "provider") {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json({ data: invoice });
  } catch (err) {
    console.error("[MISSION INVOICE] get error:", err);
    return res.status(500).json({ error: "Could not fetch mission invoice" });
  }
}

/**
 * 🔹 GET /api/v1/mission-agreements/:id/invoices
 * Récupérer toutes les factures d'une mission
 */
export async function listMissionInvoicesController(req, res) {
  try {
    const { id } = req.params; // missionAgreementId

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(id);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole === "company" && agreement.companyId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (userRole === "provider" && agreement.detailerId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const invoices = await getMissionInvoicesForAgreement(id);

    return res.json({ data: invoices });
  } catch (err) {
    console.error("[MISSION INVOICE] list error:", err);
    return res.status(500).json({ error: "Could not fetch mission invoices" });
  }
}

/**
 * 🔹 GET /api/v1/mission-invoices/number/:invoiceNumber
 * Trouver une facture par numéro
 */
export async function getMissionInvoiceByNumberController(req, res) {
  try {
    const { invoiceNumber } = req.params;

    const invoice = await getMissionInvoiceByNumber(invoiceNumber);

    if (!invoice) {
      return res.status(404).json({ error: "Mission Invoice not found" });
    }

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(invoice.missionAgreementId);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole === "company" && agreement.companyId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (userRole === "provider" && agreement.detailerId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json({ data: invoice });
  } catch (err) {
    console.error("[MISSION INVOICE] get by number error:", err);
    return res.status(500).json({ error: "Could not fetch mission invoice" });
  }
}

/**
 * 🔹 PATCH /api/v1/mission-invoices/:id/sent
 * Marquer une facture comme envoyée
 */
export async function markInvoiceAsSentController(req, res) {
  try {
    const { id } = req.params;

    // Seulement pour admin ou système automatique
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updated = await markInvoiceAsSent(id);

    return res.json({ data: updated });
  } catch (err) {
    console.error("[MISSION INVOICE] mark as sent error:", err);
    return res.status(500).json({ error: "Could not mark invoice as sent" });
  }
}

/**
 * 🔹 PATCH /api/v1/mission-invoices/:id/paid
 * Marquer une facture comme payée
 */
export async function markInvoiceAsPaidController(req, res) {
  try {
    const { id } = req.params;

    // Seulement pour admin ou système automatique
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updated = await markInvoiceAsPaid(id);

    return res.json({ data: updated });
  } catch (err) {
    console.error("[MISSION INVOICE] mark as paid error:", err);
    return res.status(500).json({ error: "Could not mark invoice as paid" });
  }
}
