// src/routes/referral.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { getReferralInfoController, getReferralStatsController } from "../controllers/referral.controller.js";

const router = Router();

router.get("/info", requireAuth, getReferralInfoController);
router.get("/stats", requireAuth, getReferralStatsController);

export default router;
