// src/services/notification.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

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

/**
 * Crée une notification dans la table notifications
 * @param {string} userId - User ID
 * @param {string} title - Titre de la notification
 * @param {string} message - Message de la notification
 * @param {string} type - Type de notification (ex: "booking", "offer", "payment")
 * @returns {Promise<Object>} Notification créée
 */
export async function createNotification(userId, title, message, type) {
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: userId,
      title,
      message,
      type,
      is_read: false,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Supprime une notification
 * @param {string} notificationId - ID de la notification
 * @param {string} userId - User ID (pour vérification de sécurité)
 * @returns {Promise<boolean>}
 */
export async function deleteNotification(notificationId, userId) {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", notificationId)
    .eq("user_id", userId);

  if (error) throw error;
  return true;
}

/**
 * Enregistre un device token (Player ID) dans la base de données pour référence.
 * 
 * ⚠️ IMPORTANT : Cette fonction est OPTIONNELLE pour iOS.
 * 
 * OneSignal SDK iOS fait automatiquement :
 * 1. Le registerDevice (via OneSignal.initialize)
 * 2. L'association avec external_user_id (via OneSignal.login(userId))
 * 
 * Cette fonction sert uniquement à :
 * - Garder une référence locale du token dans device_tokens (pour logs/débogage)
 * - Compatibilité avec Android si besoin (Android peut nécessiter un appel manuel)
 * 
 * @param {string} userId - User ID de votre backend (devient external_user_id dans OneSignal)
 * @param {string} playerId - OneSignal Player ID (identifier) ou APNs Device Token
 * @param {string} platform - "ios" ou "android"
 * @returns {Promise<boolean>}
 */
export async function subscribeDeviceToken(userId, playerId, platform = "ios") {
  if (!playerId) {
    throw new Error("Missing player ID");
  }

  const actualToken = playerId.startsWith("player-")
    ? playerId.replace("player-", "")
    : playerId.startsWith("device-")
    ? playerId.replace("device-", "")
    : playerId;

  // ✅ Enregistrer le token dans la DB pour référence locale (optionnel)
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
  
  // ⚠️ NOTE : On ne fait PAS d'appel à registerDevice() ici car :
  // - iOS : OneSignal SDK fait automatiquement registerDevice + OneSignal.login(userId) associe external_user_id
  // - Android : Si besoin, on peut appeler registerDevice manuellement, mais généralement le SDK le fait aussi
  // 
  // Si tu veux forcer un registerDevice pour Android, décommenter :
  // if (platform === "android") {
  //   await registerDevice({ userId, token: actualToken, platform });
  // }
  
  return true;
}
