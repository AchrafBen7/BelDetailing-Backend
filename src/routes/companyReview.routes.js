// src/routes/companyReview.routes.js
// Avis des detailers sur les companies (profil Company – fiabilité).

import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { listCompanyReviewsController, createCompanyReviewController } from "../controllers/companyReview.controller.js";

const router = Router();

// GET /api/v1/company-reviews?companyId=uuid — Liste des avis reçus par une company
router.get("/", listCompanyReviewsController);
// POST /api/v1/company-reviews — Detailer soumet ou met à jour un avis sur une company
router.post("/", requireAuth, createCompanyReviewController);

export default router;
