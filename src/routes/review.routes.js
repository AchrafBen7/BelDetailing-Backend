import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { createReview } from "../controllers/review.controller.js";

const router = Router();

router.post("/", requireAuth, createReview);

export default router;
