// src/routes/admin.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { getAdminDashboard } from "../controllers/admin.controller.js";

const router = Router();

// GET /api/v1/admin/dashboard — Toutes les stats admin en un seul appel
router.get("/dashboard", requireAuth, getAdminDashboard);

export default router;
