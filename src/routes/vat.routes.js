import { Router } from "express";
import {
  lookupVATController,
  validateVATController,
} from "../controllers/vat.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/lookup", lookupVATController);
router.get("/validate", requireAuth, validateVATController);

export default router;
