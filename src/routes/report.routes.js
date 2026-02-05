// src/routes/report.routes.js

import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { createReportController, getMyReportsController } from "../controllers/report.controller.js";

const router = Router();

// Créer un signalement
router.post("/", requireAuth, createReportController);

// Mes signalements
router.get("/me", requireAuth, getMyReportsController);

export default router;
