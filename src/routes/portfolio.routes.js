import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  listProviderPortfolio,
  addPortfolioPhotoController,
  deletePortfolioPhotoController,
  updatePortfolioPhotoController,
} from "../controllers/portfolio.controller.js";

const router = Router();

router.get("/:id/portfolio", listProviderPortfolio);
router.post("/me/portfolio", requireAuth, addPortfolioPhotoController);
router.delete(
  "/me/portfolio/:id",
  requireAuth,
  deletePortfolioPhotoController
);
router.patch(
  "/me/portfolio/:id",
  requireAuth,
  updatePortfolioPhotoController
);

export default router;
