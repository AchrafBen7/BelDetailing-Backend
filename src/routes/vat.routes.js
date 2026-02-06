import { Router } from "express";
import {
  lookupVATController,
  validateVATController,
} from "../controllers/vat.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

// 🔒 SECURITY: Require auth pour éviter l'abus du service VIES
router.post("/lookup", requireAuth, lookupVATController);
router.get("/validate", requireAuth, validateVATController);

export default router;
