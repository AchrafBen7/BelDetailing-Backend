// src/routes/auth.routes.js
import { Router } from "express";
import {
  register,
  login,
  refreshToken,
} from "../controllers/auth.controller.js";
import {
  loginWithApple,
  loginWithGoogle,
} from "../controllers/authSocial.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

// === AUTH ===
router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refreshToken);

// === SOCIAL AUTH ===
router.post("/apple", loginWithApple);
router.post("/google", loginWithGoogle);

export default router;
