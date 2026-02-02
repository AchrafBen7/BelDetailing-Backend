// src/controllers/notification.controller.js
import {
  getNotifications,
  markNotificationAsRead,
  deleteNotification,
  registerDeviceToken,
  getUnreadCount,
} from "../services/notification.service.js";
import { requestLogger } from "../observability/logger.js";

/**
 * GET /api/v1/notifications
 * Liste des notifications de l'utilisateur connecté
 */
export async function listNotificationsController(req, res) {
  try {
    const userId = req.user.id;
    const { unread_only, limit } = req.query;

    const notifications = await getNotifications(userId, {
      unreadOnly: unread_only === "true",
      limit: limit ? parseInt(limit, 10) : 50,
    });

    return res.json({ data: notifications });
  } catch (err) {
    requestLogger(req).error({ err }, "Notifications list error");
    return res.status(500).json({ error: "Could not fetch notifications" });
  }
}

/**
 * PATCH /api/v1/notifications/:id/read
 * Marquer une notification comme lue
 */
export async function markAsReadController(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await markNotificationAsRead(id, userId);

    return res.json({ data: notification });
  } catch (err) {
    requestLogger(req).error({ err }, "Notifications markAsRead error");
    if (err.code === "PGRST116") {
      return res.status(404).json({ error: "Notification not found" });
    }
    return res.status(500).json({ error: "Could not mark notification as read" });
  }
}

/**
 * DELETE /api/v1/notifications/:id
 * Supprimer une notification
 */
export async function deleteNotificationController(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await deleteNotification(id, userId);

    return res.json({ success: true });
  } catch (err) {
    requestLogger(req).error({ err }, "Notifications delete error");
    if (err.code === "PGRST116") {
      return res.status(404).json({ error: "Notification not found" });
    }
    return res.status(500).json({ error: "Could not delete notification" });
  }
}

/**
 * POST /api/v1/notifications/subscribe
 * Enregistrer device token (APNs) ou player_id (OneSignal) pour les push
 */
export async function subscribeController(req, res) {
  try {
    const userId = req.user.id;
    const { device_token, player_id, platform = "ios" } = req.body;

    const token = player_id || device_token;
    if (!token) {
      return res.status(400).json({ error: "Missing device_token or player_id" });
    }

    const effectivePlatform = player_id ? "onesignal" : platform;
    const deviceToken = await registerDeviceToken(userId, token, effectivePlatform);

    return res.json({ data: deviceToken });
  } catch (err) {
    console.error("[NOTIFICATIONS] subscribe error:", err);
    return res.status(500).json({ error: "Could not subscribe to notifications" });
  }
}

/**
 * GET /api/v1/notifications/unread-count
 * Récupérer le nombre de notifications non lues
 */
export async function getUnreadCountController(req, res) {
  try {
    const userId = req.user.id;

    const count = await getUnreadCount(userId);

    return res.json({ count });
  } catch (err) {
    console.error("[NOTIFICATIONS] unreadCount error:", err);
    return res.status(500).json({ error: "Could not get unread count" });
  }
}
