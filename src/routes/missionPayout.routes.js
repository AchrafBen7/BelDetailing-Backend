// src/routes/missionPayout.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  createTransferController,
  getPayoutSummaryController,
  getConnectedAccountStatusController,
} from "../controllers/missionPayout.controller.js";

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(requireAuth);

// POST /api/v1/mission-payouts/transfer
router.post("/transfer", createTransferController);

// GET /api/v1/mission-payouts/summary
router.get("/summary", getPayoutSummaryController);

// GET /api/v1/mission-payouts/account-status
router.get("/account-status", getConnectedAccountStatusController);

export default router;
