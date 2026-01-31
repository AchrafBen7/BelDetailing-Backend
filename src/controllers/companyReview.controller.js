// src/controllers/companyReview.controller.js
// Avis des detailers sur les companies (profil Company – fiabilité).

import { createOrUpdateCompanyReview, listCompanyReviews } from "../services/companyReview.service.js";

/**
 * GET /api/v1/company-reviews?companyId=uuid
 * Liste les avis reçus par une company (public ou auth).
 */
export async function listCompanyReviewsController(req, res) {
  try {
    const { companyId } = req.query;
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }
    const items = await listCompanyReviews(companyId);
    return res.json({ data: items });
  } catch (err) {
    console.error("[COMPANY_REVIEW] list error:", err);
    return res.status(500).json({ error: "Could not fetch company reviews" });
  }
}

/**
 * POST /api/v1/company-reviews
 * Body: { companyId, rating, comment?, missionAgreementId? }
 * Role: provider (detailer) only.
 */
export async function createCompanyReviewController(req, res) {
  try {
    if (req.user.role !== "provider" && req.user.role !== "provider_passionate") {
      return res.status(403).json({ error: "Only detailers can submit company reviews" });
    }

    const { companyId, rating, comment, missionAgreementId } = req.body;

    if (!companyId || rating == null) {
      return res.status(400).json({ error: "companyId and rating are required" });
    }

    const detailerUserId = req.user.id;
    const review = await createOrUpdateCompanyReview(
      detailerUserId,
      companyId,
      rating,
      comment,
      missionAgreementId
    );

    return res.status(201).json(review);
  } catch (err) {
    console.error("[COMPANY_REVIEW] create error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Could not save company review" });
  }
}
