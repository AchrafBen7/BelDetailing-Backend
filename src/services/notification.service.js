// src/services/notification.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { sendNotificationToUser } from "./onesignal.service.js";

/**
 * Types de notification pour lesquels une PUSH est envoyée (Johari 2.3 : seulement quand action requise).
 * - booking_created : provider doit confirmer/refuser la résa
 * - application_received : company doit accepter/refuser la candidature
 * - payment_failed / mission_payment_requires_method : action paiement requise
 */
const NOTIFICATION_TYPES_REQUIRING_PUSH = new Set([
  "booking_created",
  "application_received",
  "payment_failed",
  "mission_payment_requires_method",
  "mission_payment_failed",
]);

/**
 * Crée une notification dans la base de données.
 * Push (OneSignal) envoyée uniquement si type est dans NOTIFICATION_TYPES_REQUIRING_PUSH (Johari 2.3).
 * @param {Object} params
 * @param {string} params.userId - ID de l'utilisateur destinataire
 * @param {string} params.title - Titre de la notification
 * @param {string} params.message - Message de la notification
 * @param {string} params.type - Type de notification (booking_created, service_started, etc.)
 * @param {Object} params.data - Données additionnelles (booking_id, offer_id, etc.)
 * @returns {Promise<Object>} Notification créée
 */
export async function createNotification({ userId, title, message, type, data = null }) {
  const { data: notification, error } = await supabase
    .from("notifications")
    .insert({
      user_id: userId,
      title,
      message,
      type,
      data,
      is_read: false,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[NOTIFICATIONS] Error creating notification:", error);
    throw error;
  }

  // Push uniquement quand action requise (résa à confirmer, candidature, paiement) – Johari 2.3
  const shouldSendPush = NOTIFICATION_TYPES_REQUIRING_PUSH.has(type);
  if (shouldSendPush) {
    try {
      await sendNotificationToUser({
        userId,
        title,
        message,
        data: {
          type,
          ...data,
        },
      });
    } catch (notifError) {
      console.warn("[NOTIFICATIONS] OneSignal push failed (notification saved to DB):", notifError.message);
    }
  if (shouldSendPush) {
    try {
      await sendNotificationToUser({
        userId,
        title,
        message,
        data: {
          type,
          ...data,
        },
      });
    } catch (notifError) {
      console.warn("[NOTIFICATIONS] OneSignal push failed (notification saved to DB):", notifError.message);
    }
  }

  return notification;
}

/**
 * Récupère les notifications d'un utilisateur
 * @param {string} userId - ID de l'utilisateur
 * @param {Object} options - Options de filtrage
 * @param {boolean} options.unreadOnly - Récupérer uniquement les non lues
 * @param {number} options.limit - Nombre maximum de notifications
 * @returns {Promise<Array>} Liste des notifications
 */
export async function getNotifications(userId, options = {}) {
  const { unreadOnly = false, limit = 50 } = options;

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.eq("is_read", false);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[NOTIFICATIONS] Error fetching notifications:", error);
    throw error;
  }

  return data || [];
}

/**
 * Marque une notification comme lue
 * @param {string} notificationId - ID de la notification
 * @param {string} userId - ID de l'utilisateur (vérification de sécurité)
 * @returns {Promise<Object>} Notification mise à jour
 */
export async function markNotificationAsRead(notificationId, userId) {
  const { data, error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("user_id", userId) // Sécurité: s'assurer que l'utilisateur possède la notification
    .select("*")
    .single();

  if (error) {
    console.error("[NOTIFICATIONS] Error marking notification as read:", error);
    throw error;
  }

  return data;
}

/**
 * Supprime une notification
 * @param {string} notificationId - ID de la notification
 * @param {string} userId - ID de l'utilisateur (vérification de sécurité)
 * @returns {Promise<boolean>} Succès
 */
export async function deleteNotification(notificationId, userId) {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", notificationId)
    .eq("user_id", userId);

  if (error) {
    console.error("[NOTIFICATIONS] Error deleting notification:", error);
    throw error;
  }

  return true;
}

/**
 * Enregistre un device token pour les push notifications
 * @param {string} userId - ID de l'utilisateur
 * @param {string} deviceToken - Token du device
 * @param {string} platform - 'ios' ou 'android'
 * @returns {Promise<Object>} Device token enregistré
 */
export async function registerDeviceToken(userId, deviceToken, platform = "ios") {
  // Vérifier si le token existe déjà
  const { data: existing, error: findError } = await supabase
    .from("device_tokens")
    .select("*")
    .eq("device_token", deviceToken)
    .maybeSingle();

  if (findError && findError.code !== "PGRST116") {
    // PGRST116 = not found, ce qui est OK
    console.error("[NOTIFICATIONS] Error checking existing device token:", findError);
    throw findError;
  }

  if (existing) {
    // Mettre à jour si l'utilisateur a changé
    if (existing.user_id !== userId) {
      const { data: updated, error: updateError } = await supabase
        .from("device_tokens")
        .update({
          user_id: userId,
          platform,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (updateError) {
        console.error("[NOTIFICATIONS] Error updating device token:", updateError);
        throw updateError;
      }

      return updated;
    }

    return existing;
  }

  // Créer un nouveau token
  const { data: created, error: createError } = await supabase
    .from("device_tokens")
    .insert({
      user_id: userId,
      device_token: deviceToken,
      platform,
    })
    .select("*")
    .single();

  if (createError) {
    console.error("[NOTIFICATIONS] Error creating device token:", createError);
    throw createError;
  }

  return created;
}

/**
 * Récupère le nombre de notifications non lues
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<number>} Nombre de notifications non lues
 */
export async function getUnreadCount(userId) {
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) {
    console.error("[NOTIFICATIONS] Error getting unread count:", error);
    throw error;
  }

  return count || 0;
}
