// src/services/dopamineNotification.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { getProviderViewsStats } from "./dopamine.service.js";
import { getFavoritesCount } from "./favorite.service.js";
import { getUnreadMessagesCount } from "./providerMessage.service.js";

/**
 * Envoyer une notification intelligente à un provider
 * Format : "👀 5 clients ont vu votre profil aujourd'hui"
 */
export async function sendDopamineNotification(providerId, type, data) {
  try {
    // Utiliser le système de notifications existant (OneSignal)
    // Ou créer une notification dans la table notifications
    
    const notifications = {
      views: `👀 ${data.count} client${data.count > 1 ? "s ont" : " a"} vu votre profil ${data.period === "today" ? "aujourd'hui" : "cette semaine"}`,
      favorites: `⭐ ${data.count} personne${data.count > 1 ? "s ont" : " a"} enregistré votre profil ${data.period === "this_month" ? "ce mois-ci" : "cette semaine"}`,
      messages: `💬 Un client s'intéresse à vos services`,
      map: `📍 Vous apparaissez dans les résultats près de ${data.location || "votre zone"}`,
    };

    const title = notifications[type] || "Nouvelle activité sur votre profil";
    const message = data.details || "";

    // Insérer dans la table notifications (si elle existe)
    const { error } = await supabase.from("notifications").insert({
      user_id: providerId,
      title,
      message,
      type: `dopamine_${type}`,
      data: JSON.stringify(data),
    });

    if (error && error.code !== "42P01") {
      // Table n'existe pas encore, ignorer (utiliser OneSignal directement)
      console.warn("[DOPAMINE_NOTIFICATION] notifications table not found, skipping DB insert");
    }

    // TODO: Intégrer avec OneSignal pour push notification
    // await sendOneSignalPush(providerId, title, message);

    return true;
  } catch (err) {
    console.error("[DOPAMINE_NOTIFICATION] sendDopamineNotification error:", err);
    return false;
  }
}

/**
 * Digest quotidien pour un provider (à appeler via cron à 20h)
 * Compile les stats du jour et envoie une notification groupée
 */
export async function sendDailyDopamineDigest(providerId) {
  try {
    // 1) Vues du jour (depuis provider_profile_views)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count: viewsToday, error: viewsError } = await supabase
      .from("provider_profile_views")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", providerId)
      .gte("created_at", today.toISOString());

    // 2) Nouveaux intérêts (depuis provider_favorites)
    const { count: favoritesThisMonth, error: favoritesError } = await supabase
      .from("provider_favorites")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", providerId)
      .gte("created_at", new Date(new Date().setDate(1)).toISOString()); // Depuis début du mois

    // 3) Nouveaux messages non lus
    const unreadMessages = await getUnreadMessagesCount(providerId);

    // Compiler le digest
    const digest = {
      viewsToday: viewsToday || 0,
      favoritesThisMonth: favoritesThisMonth || 0,
      unreadMessages,
    };

    // Envoyer notification seulement si activité significative
    if (digest.viewsToday > 0 || digest.unreadMessages > 0) {
      let title = "Activité sur votre profil";
      let message = "";

      if (digest.viewsToday > 0) {
        message += `👀 ${digest.viewsToday} client${digest.viewsToday > 1 ? "s ont" : " a"} vu votre profil aujourd'hui.\n`;
      }

      if (digest.unreadMessages > 0) {
        message += `💬 ${digest.unreadMessages} message${digest.unreadMessages > 1 ? "s non lu" : " non lu"}.\n`;
      }

      if (digest.favoritesThisMonth > 0) {
        message += `⭐ ${digest.favoritesThisMonth} personne${digest.favoritesThisMonth > 1 ? "s intéressées" : " intéressée"} ce mois-ci.`;
      }

      await sendDopamineNotification(providerId, "digest", {
        title,
        message,
        digest,
      });
    }

    return digest;
  } catch (err) {
    console.error("[DOPAMINE_NOTIFICATION] sendDailyDopamineDigest error:", err);
    throw err;
  }
}

/**
 * Envoyer un digest quotidien pour tous les providers actifs
 * À appeler via cron (20h tous les jours)
 */
export async function sendDailyDigestToAllProviders() {
  try {
    // Récupérer tous les providers actifs (avec au moins une vue ce mois-ci)
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const { data: providers, error } = await supabase
      .from("provider_profiles")
      .select("user_id")
      .gt("profile_views_total", 0);

    if (error) throw error;

    let successCount = 0;
    let errorCount = 0;

    for (const provider of providers || []) {
      try {
        await sendDailyDopamineDigest(provider.user_id);
        successCount++;
      } catch (err) {
        console.error(`[DOPAMINE_NOTIFICATION] Error sending digest to ${provider.user_id}:`, err);
        errorCount++;
      }
    }

    console.log(
      `✅ [DOPAMINE_NOTIFICATION] Daily digest sent: ${successCount} success, ${errorCount} errors`
    );

    return { successCount, errorCount };
  } catch (err) {
    console.error("[DOPAMINE_NOTIFICATION] sendDailyDigestToAllProviders error:", err);
    throw err;
  }
}
