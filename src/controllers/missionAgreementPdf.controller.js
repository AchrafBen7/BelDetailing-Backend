// src/controllers/missionAgreementPdf.controller.js
import {
  generateMissionAgreementPdf,
  generateAndSaveMissionAgreementPdf,
} from "../services/missionAgreementPdf.service.js";
import { getMissionAgreementById } from "../services/missionAgreement.service.js";

/**
 * 🔹 GET /api/v1/mission-agreements/:id/pdf
 * Télécharger le PDF d'un Mission Agreement
 */
export async function downloadMissionAgreementPdfController(req, res) {
  try {
    const { id } = req.params;

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(id);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userRole = req.user.role;
    const userId = req.user.id;

    // Company ou detailer propriétaire, ou admin
    const isOwner = 
      (userRole === "company" && agreement.companyId === userId) ||
      (userRole === "provider" && agreement.detailerId === userId) ||
      userRole === "admin";

    if (!isOwner) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Générer le PDF
    const pdfBuffer = await generateMissionAgreementPdf(id);

    // Envoyer le PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mission-agreement-${id}.pdf"`
    );
    res.setHeader("Cache-Control", "no-store");

    return res.send(pdfBuffer);
  } catch (err) {
    console.error("[MISSION AGREEMENT PDF] download error:", err);
    return res.status(400).json({ error: err.message || "Could not generate PDF" });
  }
}

/**
 * 🔹 POST /api/v1/mission-agreements/:id/pdf/generate
 * Générer et sauvegarder le PDF d'un Mission Agreement
 */
export async function generateMissionAgreementPdfController(req, res) {
  try {
    const { id } = req.params;

    // Vérifier les permissions
    const agreement = await getMissionAgreementById(id);
    if (!agreement) {
      return res.status(404).json({ error: "Mission Agreement not found" });
    }

    const userRole = req.user.role;
    const userId = req.user.id;

    // Company ou detailer propriétaire, ou admin peut générer le PDF
    const isOwner = 
      (userRole === "company" && agreement.companyId === userId) ||
      (userRole === "provider" && agreement.detailerId === userId) ||
      userRole === "admin";

    if (!isOwner) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Générer et sauvegarder le PDF
    const pdfUrl = await generateAndSaveMissionAgreementPdf(id);

    return res.json({ data: { pdfUrl } });
  } catch (err) {
    console.error("[MISSION AGREEMENT PDF] generate error:", err);
    return res.status(400).json({ error: err.message || "Could not generate PDF" });
  }
}
