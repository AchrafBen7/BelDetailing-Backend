// src/routes/profile.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { getProfile } from "../controllers/profile.controller.js";

const router = Router();

// GET /api/v1/profile
router.get("/", requireAuth, getProfile);

export default router;
