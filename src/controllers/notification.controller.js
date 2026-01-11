// src/controllers/notification.controller.js
import {
  getNotifications,
  markNotificationAsRead,
  subscribeDeviceToken,
  deleteNotification,
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

/**
 * Enregistre un device token (Player ID) pour référence locale.
 * 
 * ⚠️ IMPORTANT : Cette fonction est OPTIONNELLE pour iOS.
 * 
 * OneSignal SDK iOS fait automatiquement :
 * 1. Le registerDevice (via OneSignal.initialize)
 * 2. L'association avec external_user_id (via OneSignal.login(userId))
 * 
 * Cette endpoint sert uniquement à :
 * - Garder une référence locale du token dans device_tokens (pour logs/débogage)
 * - Compatibilité avec Android si besoin
 * 
 * Pour iOS : Le client appelle cette endpoint optionnellement après OneSignal.login()
 * Pour Android : Peut servir si besoin d'un registerDevice manuel
 * 
 * Body params :
 * - device_token (optionnel) : APNs Device Token ou FCM Token
 * - player_id (optionnel) : OneSignal Player ID
 * - platform (optionnel, default: "ios") : "ios" ou "android"
 */
export async function subscribeToTopic(req, res) {
  try {
    const { topic } = req.query;
    const { device_token, player_id, platform } = req.body;

    const token = device_token || player_id || topic;
    if (!token) {
      return res
        .status(400)
        .json({ error: "Missing device_token or player_id" });
    }
    
    // ⚠️ Cette fonction enregistre juste le token dans la DB pour référence
    // OneSignal SDK iOS fait déjà tout automatiquement (registerDevice + external_user_id)
    await subscribeDeviceToken(req.user.id, token, platform || "ios");

    return res.json({ success: true });
  } catch (err) {
    console.error("[NOTIFICATIONS] subscribe error:", err);
    return res.status(500).json({ error: "Could not subscribe" });
  }
}

export async function deleteNotificationController(req, res) {
  try {
    const { id } = req.params;
    await deleteNotification(id, req.user.id);
    return res.json({ success: true });
  } catch (err) {
    console.error("[NOTIFICATIONS] delete error:", err);
    return res.status(500).json({ error: "Could not delete notification" });
  }
}
