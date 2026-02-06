// src/routes/utils.routes.js
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validateVAT } from "../controllers/utils.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

// 🛡️ SÉCURITÉ : Rate limit strict pour API VAT (éviter DoS sur VIES européen)
// - 10 requêtes par 15 minutes par IP
// - Protège notre backend + service VIES
const vatRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requêtes max
  message: "Trop de requêtes de validation TVA, réessayez dans 15 minutes",
  standardHeaders: true,
  legacyHeaders: false,
});

// 🛡️ SÉCURITÉ : Authentification obligatoire + rate limit dédié
router.get("/vat/validate", requireAuth, vatRateLimiter, validateVAT);

export default router;
