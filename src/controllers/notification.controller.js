// src/controllers/notification.controller.js
import {
  getNotifications,
  markNotificationAsRead,
  subscribeDeviceToken,
} from "../services/notification.service.js";

export async function listNotifications(req, res) {
  try {
    const { limit, unread_only } = req.query;
    const items = await getNotifications(req.user.id, {
      limit,
      unreadOnly: unread_only === "true",
    });
    return res.json({ data: items });
  } catch (err) {
    console.error("[NOTIFICATIONS] list error:", err);
    return res.status(500).json({ error: "Could not fetch notifications" });
  }
}

export async function markAsRead(req, res) {
  try {
    const { id } = req.params;
    await markNotificationAsRead(id, req.user.id);
    return res.json({ success: true });
  } catch (err) {
    console.error("[NOTIFICATIONS] markAsRead error:", err);
    return res.status(500).json({ error: "Could not mark as read" });
  }
}

export async function subscribeToTopic(req, res) {
  try {
    const { topic } = req.query;
    const { device_token, platform } = req.body;

    const token = device_token || topic;
    await subscribeDeviceToken(req.user.id, token, platform || "ios");

    return res.json({ success: true });
  } catch (err) {
    console.error("[NOTIFICATIONS] subscribe error:", err);
    return res.status(500).json({ error: "Could not subscribe" });
  }
}
