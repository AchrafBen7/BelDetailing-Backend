// src/routes/referral.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { getReferralInfoController } from "../controllers/referral.controller.js";

const router = Router();

router.get("/info", requireAuth, getReferralInfoController);

export default router;
