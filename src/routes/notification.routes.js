// src/routes/notification.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  listNotificationsController,
  markAsReadController,
  deleteNotificationController,
  subscribeController,
  getUnreadCountController,
} from "../controllers/notification.controller.js";

const router = Router();

// Toutes les routes nécessitent une authentification
router.get("/", requireAuth, listNotificationsController);
router.get("/unread-count", requireAuth, getUnreadCountController);
router.patch("/:id/read", requireAuth, markAsReadController);
router.delete("/:id", requireAuth, deleteNotificationController);
router.post("/subscribe", requireAuth, subscribeController);

export default router;
