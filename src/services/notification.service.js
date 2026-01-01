// src/services/notification.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { registerDevice } from "./onesignal.service.js";

export async function getNotifications(userId, { limit, unreadOnly } = {}) {
  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (unreadOnly) {
    query = query.eq("is_read", false);
  }

  if (limit) {
    query = query.limit(Number(limit));
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function markNotificationAsRead(notificationId, userId) {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("user_id", userId);

  if (error) throw error;
  return true;
}

export async function subscribeDeviceToken(userId, deviceToken, platform = "ios") {
  if (!deviceToken) {
    throw new Error("Missing device token");
  }

  const actualToken = deviceToken.startsWith("device-")
    ? deviceToken.replace("device-", "")
    : deviceToken;

  const { error } = await supabase
    .from("device_tokens")
    .upsert(
      {
        user_id: userId,
        device_token: actualToken,
        platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "device_token" }
    );

  if (error) throw error;
  await registerDevice({ userId, token: actualToken, platform });
  return true;
}
