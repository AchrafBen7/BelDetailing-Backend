import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { reportNoShowController } from "../controllers/noShow.controller.js";

const router = Router();

router.post("/:id/no-show", requireAuth, reportNoShowController);

export default router;
