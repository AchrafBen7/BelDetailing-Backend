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

export async function sendNotificationToUser({ userId, title, message, data }) {
  ensureConfigured();

  const response = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      include_external_user_ids: [userId],
      headings: { en: title },
      contents: { en: message },
      data: data || undefined,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OneSignal send failed: ${text}`);
  }

  return response.json();
}
