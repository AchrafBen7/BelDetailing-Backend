import { Router } from "express";
import {
  lookupVATController,
  validateVATController,
} from "../controllers/vat.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

// 🔒 SECURITY: Require auth pour éviter l'abus du service VIES
router.post("/lookup", requireAuth, lookupVATController);
// 🔒 SECURITY: Accepter GET (rétro-compat) et POST (préféré, pas de PII dans l'URL)
router.get("/validate", requireAuth, validateVATController);
router.post("/validate", requireAuth, validateVATController);

export default router;
