import { Router } from "express";
import { getProfile } from "../controllers/profile.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

router.get("/", requireAuth, getProfile);

export default router;
