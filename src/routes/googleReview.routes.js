import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  createReviewPromptController,
  getReviewPromptController,
  trackRatingController,
  trackGoogleRedirectController,
  dismissPromptController,
  importGoogleReviewsController,
} from "../controllers/googleReview.controller.js";

const router = Router();

router.use(requireAuth);

router.post("/prompt", createReviewPromptController);
router.get("/prompt/:bookingId", getReviewPromptController);
router.post("/prompt/:id/rating", trackRatingController);
router.post("/prompt/:id/google-redirect", trackGoogleRedirectController);
router.post("/prompt/:id/dismiss", dismissPromptController);

/** Import avis Google (prestataire uniquement) */
router.post("/import", importGoogleReviewsController);

export default router;
