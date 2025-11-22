// src/routes/auth.routes.js
import { Router } from "express";
import {
  register,
  login,
  refreshToken,
  getProfile,
  updateProfile,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

// === AUTH ===
router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refreshToken);

// === PROFILE (monté sur /api/v1/profile dans app.js) ===
router.get("/", requireAuth, getProfile);
router.patch("/", requireAuth, updateProfile);

export default router;
