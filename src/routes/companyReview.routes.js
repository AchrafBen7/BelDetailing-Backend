// src/routes/companyReview.routes.js
// Avis des detailers sur les companies (profil Company – fiabilité).

import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { listCompanyReviewsController, createCompanyReviewController } from "../controllers/companyReview.controller.js";

const router = Router();

// 🔒 SECURITY: Require auth pour empêcher le scraping public des avis company
router.get("/", requireAuth, listCompanyReviewsController);
// POST /api/v1/company-reviews — Detailer soumet ou met à jour un avis sur une company
router.post("/", requireAuth, createCompanyReviewController);

export default router;
