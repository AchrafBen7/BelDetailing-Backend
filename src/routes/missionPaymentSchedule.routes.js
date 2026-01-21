// src/routes/missionPaymentSchedule.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  createInitialPaymentsController,
  authorizeAllPaymentsController,
  getNextPaymentController,
  getPaymentSummaryController,
  captureNextPaymentController,
} from "../controllers/missionPaymentSchedule.controller.js";

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(requireAuth);

// POST /api/v1/mission-payments/schedule/create
router.post("/create", createInitialPaymentsController);

// POST /api/v1/mission-payments/schedule/authorize-all
router.post("/authorize-all", authorizeAllPaymentsController);

// GET /api/v1/mission-payments/schedule/next
router.get("/next", getNextPaymentController);

// GET /api/v1/mission-payments/schedule/summary
router.get("/summary", getPaymentSummaryController);

// POST /api/v1/mission-payments/schedule/capture-next
router.post("/capture-next", captureNextPaymentController);

export default router;
