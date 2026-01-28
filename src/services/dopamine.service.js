// src/services/dopamine.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * Track une vue d'un provider profile
 * @param {string} providerId - ID du provider (user_id ou id selon DB)
 * @param {string|null} customerId - ID du customer (peut être null si anonyme)
 * @param {string} viewType - 'profile' | 'card' | 'map'
 */
export async function trackProviderView(providerId, customerId, viewType = "profile") {
  try {
    // 1) Identifier le provider (gérer user_id vs id)
    const { data: provider, error: providerError } = await supabase
      .from("provider_profiles")
      .select("user_id")
      .or(`id.eq.${providerId},user_id.eq.${providerId}`)
      .maybeSingle();

    if (providerError || !provider) {
      console.warn("[DOPAMINE] Provider not found:", providerId);
      return false;
    }

    const providerUserId = provider.user_id || providerId;

    // 2) Incrémenter profile_views_total
    const { error: updateError } = await supabase.rpc("increment_profile_views", {
      provider_user_id: providerUserId,
    });

    // Si RPC n'existe pas, utiliser update manuel
    if (updateError && updateError.code === "42883") {
      const { data: current, error: fetchError } = await supabase
        .from("provider_profiles")
        .select("profile_views_total, profile_views_this_week")
        .eq("user_id", providerUserId)
        .single();

      if (!fetchError && current) {
        await supabase
          .from("provider_profiles")
          .update({
            profile_views_total: (current.profile_views_total || 0) + 1,
            profile_views_this_week: (current.profile_views_this_week || 0) + 1,
            profile_views_updated_at: new Date().toISOString(),
          })
          .eq("user_id", providerUserId);
      }
    }

    // 3) (Optionnel) Insérer dans provider_profile_views pour analytics détaillés
    if (customerId) {
      await supabase.from("provider_profile_views").insert({
        provider_id: providerUserId,
        customer_id: customerId,
        view_type: viewType,
      });
    } else {
      // Vue anonyme
      await supabase.from("provider_profile_views").insert({
        provider_id: providerUserId,
        customer_id: null,
        view_type: viewType,
      });
    }

    return true;
  } catch (err) {
    console.error("[DOPAMINE] trackProviderView error:", err);
    return false;
  }
}

/**
 * Récupère les stats de vues pour un provider
 * @param {string} providerUserId - user_id du provider
 */
export async function getProviderViewsStats(providerUserId) {
  try {
    // 1) Récupérer les stats du profil
    const { data, error } = await supabase
      .from("provider_profiles")
      .select("profile_views_total, profile_views_this_week, profile_views_last_week, profile_views_updated_at")
      .eq("user_id", providerUserId)
      .single();

    if (error) throw error;

    const thisWeek = data.profile_views_this_week || 0;
    const lastWeek = data.profile_views_last_week || 0;

    // 2) 🆕 Calculer les vues du mois (depuis provider_profile_views)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    
    const { data: monthViews, error: monthError } = await supabase
      .from("provider_profile_views")
      .select("id")
      .eq("provider_user_id", providerUserId)
      .gte("viewed_at", startOfMonth.toISOString());
    
    const thisMonth = monthViews?.length || 0;
    
    // 3) 🆕 Calculer les vues de l'année
    const { data: yearViews, error: yearError } = await supabase
      .from("provider_profile_views")
      .select("id")
      .eq("provider_user_id", providerUserId)
      .gte("viewed_at", startOfYear.toISOString());
    
    const thisYear = yearViews?.length || 0;

    // 4) Variation (semaine)
    let variationPercent = 0;
    if (lastWeek > 0) {
      variationPercent = ((thisWeek - lastWeek) / lastWeek) * 100;
    } else if (thisWeek > 0) {
      variationPercent = 100; // Nouvelles vues
    }

    return {
      total: data.profile_views_total || 0,
      thisWeek,
      thisMonth, // 🆕 Vues du mois
      thisYear, // 🆕 Vues de l'année
      lastWeek,
      variationPercent: Math.round(variationPercent),
    };
  } catch (err) {
    console.error("[DOPAMINE] getProviderViewsStats error:", err);
    throw err;
  }
}

/**
 * Reset hebdomadaire (à appeler via cron quotidien, dimanche à minuit)
 * Déplace profile_views_this_week → profile_views_last_week
 */
export async function resetWeeklyViews() {
  try {
    // Récupérer tous les providers avec this_week > 0
    const { data: providers, error } = await supabase
      .from("provider_profiles")
      .select("user_id, profile_views_this_week")
      .gt("profile_views_this_week", 0);

    if (error) throw error;

    // Mettre à jour chaque provider
    for (const provider of providers || []) {
      await supabase
        .from("provider_profiles")
        .update({
          profile_views_last_week: provider.profile_views_this_week,
          profile_views_this_week: 0,
          profile_views_updated_at: new Date().toISOString(),
        })
        .eq("user_id", provider.user_id);
    }

    console.log(`✅ [DOPAMINE] Reset weekly views for ${providers?.length || 0} providers`);
    return true;
  } catch (err) {
    console.error("[DOPAMINE] resetWeeklyViews error:", err);
    return false;
  }
}
