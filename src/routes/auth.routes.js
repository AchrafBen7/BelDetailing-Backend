// src/routes/auth.routes.js
import { Router } from "express";
import {
  register,
  login,
  refreshToken,
  logout,
  changePassword,
  verifyEmail,
  resendVerificationEmailController,
} from "../controllers/auth.controller.js";
import {
  loginWithApple,
  loginWithGoogle,
} from "../controllers/authSocial.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { validateRequest } from "../validators/index.js";
import {
  registerValidation,
  loginValidation,
  refreshTokenValidation,
} from "../validators/auth.validator.js";

const router = Router();

// === AUTH ===
router.post("/register", registerValidation, validateRequest, register);
router.post("/login", loginValidation, validateRequest, login);
router.post("/refresh", refreshTokenValidation, validateRequest, refreshToken);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification-email", resendVerificationEmailController);

// === SOCIAL AUTH ===
router.post("/apple", loginWithApple);
router.post("/google", loginWithGoogle);

router.post("/logout", requireAuth, logout);
router.post("/change-password", requireAuth, changePassword);

export default router;
