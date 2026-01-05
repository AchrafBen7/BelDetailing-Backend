import { Router } from "express";
import {
  lookupVATController,
  validateVATController,
} from "../controllers/vat.controller.js";

const router = Router();

router.post("/lookup", lookupVATController);
router.get("/validate", validateVATController);

export default router;
