// src/services/adminNotification.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { sendNotificationToUser } from "./onesignal.service.js";

/**
 * 🟦 NOTIFY ADMIN – Notifier les administrateurs en cas d'erreur critique
 * 
 * Cette fonction envoie une notification aux utilisateurs avec le rôle "admin"
 * pour les erreurs critiques qui nécessitent une intervention manuelle.
 * 
 * @param {Object} params
 * @param {string} params.title - Titre de l'erreur
 * @param {string} params.message - Message détaillé de l'erreur
 * @param {string} params.type - Type d'erreur (ex: "transfer_failed", "invoice_generation_failed")
 * @param {Object} params.context - Contexte additionnel (paymentId, agreementId, etc.)
 * @returns {Promise<void>}
 */
export async function notifyAdmin({ title, message, type, context = {} }) {
  try {
    // 1) Récupérer tous les utilisateurs avec le rôle "admin"
    const { data: admins, error } = await supabase
      .from("users")
      .select("id, email")
      .eq("role", "admin");

    if (error) {
      console.error("[ADMIN NOTIFICATION] Error fetching admins:", error);
      return;
    }

    if (!admins || admins.length === 0) {
      console.warn("⚠️ [ADMIN NOTIFICATION] No admin users found");
      return;
    }

    // 2) Envoyer une notification à chaque admin
    const notificationPromises = admins.map((admin) =>
      sendNotificationToUser({
        userId: admin.id,
        title: `🔴 ${title}`,
        message: message,
        data: {
          type: "admin_alert",
          alert_type: type,
          ...context,
        },
      }).catch((err) => {
        console.error(`[ADMIN NOTIFICATION] Failed to notify admin ${admin.id}:`, err);
        return null;
      })
    );

    await Promise.all(notificationPromises);

    console.log(`✅ [ADMIN NOTIFICATION] Notified ${admins.length} admin(s) about: ${type}`);
  } catch (err) {
    console.error("[ADMIN NOTIFICATION] Error notifying admins:", err);
    // Ne pas faire échouer le processus si la notification admin échoue
  }
}

/**
 * 🟦 LOG CRITICAL ERROR – Logger une erreur critique avec contexte détaillé
 * 
 * Cette fonction log une erreur avec tous les détails nécessaires pour le debugging.
 * 
 * @param {Object} params
 * @param {string} params.service - Nom du service (ex: "MISSION PAYOUT", "MISSION INVOICE")
 * @param {string} params.function - Nom de la fonction
 * @param {Error} params.error - L'erreur
 * @param {Object} params.context - Contexte additionnel
 */
export function logCriticalError({ service, function: functionName, error, context = {} }) {
  const timestamp = new Date().toISOString();
  const errorDetails = {
    service,
    function: functionName,
    timestamp,
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    context,
  };

  console.error("=".repeat(80));
  console.error(`❌ [${service}] CRITICAL ERROR in ${functionName}`);
  console.error(`❌ [${service}] Timestamp: ${timestamp}`);
  console.error(`❌ [${service}] Error:`, error.message);
  console.error(`❌ [${service}] Stack:`, error.stack);
  console.error(`❌ [${service}] Context:`, JSON.stringify(context, null, 2));
  console.error("=".repeat(80));

  // TODO: Dans le futur, envoyer ces logs à un service de logging centralisé (Sentry, LogRocket, etc.)
  return errorDetails;
}
