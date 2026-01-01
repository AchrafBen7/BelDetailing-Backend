// src/routes/notification.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  listNotifications,
  markAsRead,
  subscribeToTopic,
} from "../controllers/notification.controller.js";

const router = Router();

router.get("/", requireAuth, listNotifications);
router.patch("/:id/read", requireAuth, markAsRead);
router.post("/subscribe", requireAuth, subscribeToTopic);

export default router;
