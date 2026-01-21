// src/routes/missionInvoice.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  createCompanyInvoiceController,
  createDetailerInvoiceController,
  getMissionInvoiceController,
  listMissionInvoicesController,
  getMissionInvoiceByNumberController,
  markInvoiceAsSentController,
  markInvoiceAsPaidController,
} from "../controllers/missionInvoice.controller.js";

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(requireAuth);

// ⚠️ Routes spécifiques AVANT les routes paramétrées
// GET /api/v1/mission-invoices/number/:invoiceNumber
router.get("/number/:invoiceNumber", getMissionInvoiceByNumberController);

// ⚠️ Routes imbriquées pour /mission-agreements/:id/invoices (montées sur /mission-agreements)
// GET /api/v1/mission-agreements/:id/invoices
router.get("/:id/invoices", listMissionInvoicesController);

// GET /api/v1/mission-invoices/:id
router.get("/:id", getMissionInvoiceController);

// POST /api/v1/mission-invoices/company
router.post("/company", createCompanyInvoiceController);

// POST /api/v1/mission-invoices/detailer (admin only)
router.post("/detailer", createDetailerInvoiceController);

// PATCH /api/v1/mission-invoices/:id/sent (admin only)
router.patch("/:id/sent", markInvoiceAsSentController);

// PATCH /api/v1/mission-invoices/:id/paid (admin only)
router.patch("/:id/paid", markInvoiceAsPaidController);

export default router;
