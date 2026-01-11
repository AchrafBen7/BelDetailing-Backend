// src/routes/notification.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  listNotifications,
  markAsRead,
  subscribeToTopic,
  deleteNotificationController,
} from "../controllers/notification.controller.js";

const router = Router();

router.get("/", requireAuth, listNotifications);
router.patch("/:id/read", requireAuth, markAsRead);
router.delete("/:id", requireAuth, deleteNotificationController);
router.post("/subscribe", requireAuth, subscribeToTopic);

export default router;
