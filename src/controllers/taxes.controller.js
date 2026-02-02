import {
  computeMonthlySummary,
  buildDocumentsList,
  providerHasActivity,
} from "../services/taxes.service.js";
import { generateDocumentPDF } from "../services/taxes.document.service.js";

export async function getMonthlySummary(req, res) {
  try {
    const role = req.user.role || "";
    if (role !== "provider" && role !== "provider_passionate") {
      return res.status(403).json({ error: "Providers only" });
    }

    const { month } = req.query;
    if (!month) {
      return res.status(400).json({ error: "Missing month" });
    }

    const summary = await computeMonthlySummary(req.user.id, month);
    return res.json(summary);
  } catch (err) {
    console.error("[TAXES] summary error:", err);
    return res.status(500).json({ error: "Could not compute summary" });
  }
}

export async function listDocuments(req, res) {
  try {
    const { month } = req.query;
    if (!month) {
      return res.status(400).json({ error: "Missing month" });
    }

    const role = req.user.role || "customer";
    const docs = await buildDocumentsList(req.user.id, month, role);
    return res.json({ data: docs });
  } catch (err) {
    console.error("[TAXES] documents error:", err);
    return res.status(500).json({ error: "Could not list documents" });
  }
}

export async function downloadDocument(req, res) {
  try {
    const role = req.user.role || "";
    if (role !== "provider" && role !== "provider_passionate") {
      return res.status(403).json({ error: "Providers only" });
    }

    const documentId = req.params.id;
    if (documentId.startsWith("booking-") || documentId.startsWith("mission-invoice-")) {
      return res.status(400).json({ error: "Use openUrl for this document" });
    }

    const parts = documentId.split("-");
    const month = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : null;
    if (!month) {
      return res.status(400).json({ error: "Invalid document id" });
    }

    if (!(await providerHasActivity(req.user.id, month))) {
      return res.status(404).json({ error: "No document for this period" });
    }

    const pdfBuffer = await generateDocumentPDF(req.user.id, documentId);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${documentId}.pdf"`
    );
    res.setHeader("Cache-Control", "no-store");

    return res.send(pdfBuffer);
  } catch (err) {
    console.error("[TAXES] download error:", err);
    return res.status(400).json({ error: err.message });
  }
}

