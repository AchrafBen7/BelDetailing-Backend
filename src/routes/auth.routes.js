// src/routes/auth.routes.js
import { Router } from "express";
import {
  register,
  login,
  refreshToken,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

// === AUTH ===
router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refreshToken);


export default router;
