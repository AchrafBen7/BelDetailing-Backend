import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  withdrawApplicationController,
  acceptApplicationController,
  refuseApplicationController,
  getMyApplicationsController,
} from "../controllers/application.controller.js";

const router = Router();

// /api/v1/applications/me (provider)
router.get("/me", requireAuth, getMyApplicationsController);

// /api/v1/applications/:id/withdraw
router.post("/:id/withdraw", requireAuth, withdrawApplicationController); // que les providers

// /api/v1/applications/:id/accept
router.post("/:id/accept", requireAuth, acceptApplicationController); // que les company 

// /api/v1/applications/:id/refuse
router.post("/:id/refuse", requireAuth, refuseApplicationController); // que les company

export default router;
