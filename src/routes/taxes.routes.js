import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  getMonthlySummary,
  listDocuments,
  downloadDocument,
} from "../controllers/taxes.controller.js";

const router = Router();

router.get("/summary", requireAuth, getMonthlySummary);
router.get("/documents", requireAuth, listDocuments);
router.get("/documents/:id/download", requireAuth, downloadDocument);
export default router;
