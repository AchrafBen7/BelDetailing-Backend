// src/controllers/report.controller.js

import { createReport, getMyReports } from "../services/report.service.js";

/**
 * POST /api/v1/reports
 * Créer un signalement
 */
export async function createReportController(req, res) {
  try {
    const reporterId = req.user?.id;
    if (!reporterId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const {
      reportedUserId,
      contentType,
      contentId,
      reason,
      description
    } = req.body;
    
    if (!contentType || !contentId || !reason) {
      return res.status(400).json({
        error: "Missing required fields: contentType, contentId, reason"
      });
    }
    
    const report = await createReport({
      reporterId,
      reportedUserId,
      contentType,
      contentId,
      reason,
      description
    });
    
    return res.status(201).json({
      success: true,
      message: "Signalement envoyé. Nous le traiterons dans les 24h.",
      report
    });
  } catch (err) {
    console.error("[REPORTS] create error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message });
  }
}

/**
 * GET /api/v1/reports/me
 * Mes signalements
 */
export async function getMyReportsController(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const reports = await getMyReports(userId);
    return res.json({ data: reports });
  } catch (err) {
    console.error("[REPORTS] list error:", err);
    return res.status(500).json({ error: "Could not fetch reports" });
  }
}
