// src/routes/profile.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { validateRequest } from "../validators/index.js";
import { updateProfileValidation } from "../validators/profile.validator.js";
import { getProfile, updateProfile } from "../controllers/profile.controller.js";

const router = Router();

// GET /api/v1/profile
// === PROFILE (monté sur /api/v1/profile dans app.js) ===
router.get("/", requireAuth, getProfile);
router.patch("/", requireAuth, updateProfileValidation, validateRequest, updateProfile);

export default router;
