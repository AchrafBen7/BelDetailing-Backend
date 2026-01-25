// src/services/onesignal.service.js
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

function getDeviceType(platform) {
  if (platform === "android") return 1;
  return 0;
}

function ensureConfigured() {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    throw new Error("OneSignal is not configured");
  }
}

/**
 * ⚠️ DÉPRÉCIÉ pour iOS - Utilisé uniquement pour compatibilité Android si nécessaire.
 * 
 * Pour iOS :
 * - OneSignal SDK iOS fait automatiquement le registerDevice lors de OneSignal.initialize()
 * - OneSignal.login(userId) associe automatiquement external_user_id
 * - AUCUN appel backend nécessaire
 * 
 * Pour Android :
 * - Généralement le SDK Android fait aussi le registerDevice automatiquement
 * - Cette fonction peut servir si tu veux forcer un registerDevice côté backend
 * 
 * @param {string} userId - User ID de votre backend (devient external_user_id dans OneSignal)
 * @param {string} token - Device token (APNs pour iOS, FCM pour Android)
 * @param {string} platform - "ios" ou "android"
 * @returns {Promise<Object>} OneSignal Player object
 */
export async function registerDevice({ userId, token, platform = "ios" }) {
  // ✅ Vérifier si OneSignal est configuré, sinon retourner silencieusement
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    console.warn("[ONESIGNAL] OneSignal is not configured. Skipping device registration.");
    return { success: false, reason: "OneSignal not configured" };
  }

  const response = await fetch("https://onesignal.com/api/v1/players", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      identifier: token,
      device_type: getDeviceType(platform),
      external_user_id: userId,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OneSignal device register failed: ${text}`);
  }

  return response.json();
}

/**
 * Envoie une notification à un utilisateur spécifique via OneSignal.
 * 
 * ✅ CRITIQUE : Utilise external_user_id (userId) pour envoyer à un utilisateur spécifique.
 * L'utilisateur doit avoir appelé OneSignal.login(userId) côté iOS pour que ça fonctionne.
 * 
 * @param {Object} params - Paramètres de notification
 * @param {string} params.userId - User ID (devient external_user_id dans OneSignal)
 * @param {string} params.title - Titre de la notification
 * @param {string} params.message - Message de la notification
 * @param {Object} params.data - Données additionnelles (optionnel)
 * @param {string} params.url - Deep link URL (optionnel, pour routing iOS)
 * @returns {Promise<Object>} Réponse OneSignal
 */
export async function sendNotificationToUser({ userId, title, message, data, url }) {
  // ✅ Vérifier si OneSignal est configuré, sinon retourner silencieusement
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    console.warn("[ONESIGNAL] OneSignal is not configured (ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY missing). Skipping push notification.");
    return { success: false, reason: "OneSignal not configured" };
  }

  const payload = {
    app_id: ONESIGNAL_APP_ID,
    // ✅ CRITIQUE : Utilise external_user_id (userId) pour envoyer à un utilisateur spécifique
    include_external_user_ids: [userId],
    headings: { en: title },
    contents: { en: message },
    data: data || undefined,
  };

  // ✅ OPTIONNEL : Ajouter deep link pour routing iOS
  if (url) {
    payload.url = url;
  }

  try {
    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OneSignal send failed: ${text}`);
    }

    return response.json();
  } catch (error) {
    console.error("[ONESIGNAL] Error sending push notification:", error.message);
    throw error; // Re-throw pour que l'appelant puisse gérer
  }
}

/**
 * ✅ NOUVEAU : Fonction helper pour envoyer notification avec deep link automatique.
 * 
 * Facilite l'envoi de notifications avec routing automatique vers les bonnes écrans iOS.
 * 
 * ⚠️ IMPORTANT : Cette fonction enregistre aussi la notification dans la table notifications
 * pour que l'utilisateur puisse la voir dans la page de notifications de l'app.
 * 
 * @param {Object} params - Paramètres de notification
 * @param {string} params.userId - User ID (devient external_user_id dans OneSignal)
 * @param {string} params.title - Titre de la notification
 * @param {string} params.message - Message de la notification
 * @param {string} params.type - Type de notification (ex: "booking_confirmed", "payment_success")
 * @param {string} params.id - ID de l'entité (ex: booking_id, offer_id, transaction_id)
 * @param {string} params.deepLink - Deep link personnalisé (optionnel, sinon généré automatiquement)
 * @returns {Promise<Object>} Réponse OneSignal
 * 
 * @example
 * await sendNotificationWithDeepLink({
 *   userId: "user-123",
 *   title: "Réservation confirmée",
 *   message: "Votre rendez-vous est confirmé.",
 *   type: "booking_confirmed",
 *   id: "booking-456",
 *   // deepLink optionnel, sinon généré: "beldetailing://booking_confirmed/booking-456"
 * });
 */
export async function sendNotificationWithDeepLink({ userId, title, message, type, id, deepLink }) {
  // Générer le deep link automatiquement si non fourni
  const finalDeepLink = deepLink || `beldetailing://${type}/${id}`;

  // ✅ Enregistrer la notification dans la table notifications AVANT l'envoi OneSignal
  // Cette partie DOIT toujours fonctionner, même si OneSignal n'est pas configuré
  try {
    const { createNotification } = await import("./notification.service.js");
    // Normaliser le type (ex: "booking_created" → "booking", "service_started" → "service")
    const normalizedType = type.includes("_") ? type.split("_")[0] : type;
    // ✅ Vérifier que userId n'est pas null avant d'appeler createNotification
    if (!userId) {
      console.warn("[ONESIGNAL] userId is null, skipping DB notification save");
    } else {
      // ✅ IMPORTANT : Utiliser directement supabase pour enregistrer en DB
      // sans passer par sendNotificationToUser (qui nécessite OneSignal)
      const { supabaseAdmin } = await import("../config/supabase.js");
      const { error: dbError } = await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: userId,
          title,
          message,
          type: normalizedType,
          data: id ? { type, id } : null,
          is_read: false,
        });

      if (dbError) {
        console.error("[ONESIGNAL] Failed to save notification to DB:", dbError);
        // Ne pas throw, continuer quand même
      } else {
        console.log("[ONESIGNAL] Notification saved to DB successfully");
      }
    }
  } catch (dbError) {
    // ⚠️ Si l'enregistrement en DB échoue, on continue quand même
    console.error("[ONESIGNAL] Failed to save notification to DB:", dbError);
  }

  // ✅ Envoyer la notification push via OneSignal (si configuré)
  // Si OneSignal n'est pas configuré, on ignore silencieusement l'erreur
  try {
    return await sendNotificationToUser({
      userId,
      title,
      message,
      url: finalDeepLink, // Deep link pour routing iOS
      data: {
        type,
        id, // booking_id, offer_id, transaction_id, etc.
        deep_link: finalDeepLink, // Garder aussi dans data pour référence
      },
    });
  } catch (onesignalError) {
    // ⚠️ Si OneSignal n'est pas configuré ou échoue, on log mais on ne throw pas
    // La notification est déjà enregistrée en DB, donc l'utilisateur la verra dans l'app
    console.warn("[ONESIGNAL] OneSignal push notification failed (notification still saved to DB):", onesignalError.message);
    // Retourner un objet vide pour indiquer que la notification DB a été créée
    return { success: false, onesignalError: onesignalError.message, dbSaved: true };
  }
}
