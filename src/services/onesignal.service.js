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
  ensureConfigured();

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
  ensureConfigured();

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
}

/**
 * ✅ NOUVEAU : Fonction helper pour envoyer notification avec deep link automatique.
 * 
 * Facilite l'envoi de notifications avec routing automatique vers les bonnes écrans iOS.
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

  return sendNotificationToUser({
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
}
