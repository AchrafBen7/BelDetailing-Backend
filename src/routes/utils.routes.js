// src/routes/utils.routes.js
import { Router } from "express";
import { validateVAT } from "../controllers/utils.controller.js";

const router = Router();

router.get("/vat/validate", validateVAT);

export default router;
