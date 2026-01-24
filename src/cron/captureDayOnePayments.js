// src/cron/captureDayOnePayments.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { captureDayOnePayments } from "../services/missionPaymentDayOne.service.js";

/**
 * 🟦 CAPTURE DAY ONE PAYMENTS CRON – Capturer automatiquement les paiements du jour 1
 * 
 * Cette fonction est appelée par un cron job (ex: toutes les heures) pour capturer
 * les paiements du jour 1 (commission NIOS + acompte detailer) pour les missions
 * dont le startDate est aujourd'hui.
 * 
 * @param {string|null} date - Date au format YYYY-MM-DD (optionnel, défaut: aujourd'hui)
 * @returns {Promise<Object>} Résultat avec statistiques
 */
export async function captureDayOnePaymentsCron(date = null) {
  const targetDate = date ? new Date(date) : new Date();
  targetDate.setHours(0, 0, 0, 0);

  const dateString = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD

  console.log(`🔄 [CRON DAY ONE] Capturing day one payments for date: ${dateString}`);

  // 1) Récupérer les missions actives dont le startDate est aujourd'hui
  const { data: agreements, error } = await supabase
    .from("mission_agreements")
    .select("*")
    .eq("status", "active")
    .gte("start_date", dateString)
    .lt("start_date", new Date(targetDate.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

  if (error) {
    console.error("❌ [CRON DAY ONE] Error fetching day one missions:", error);
    throw error;
  }

  if (!agreements || agreements.length === 0) {
    console.log("ℹ️ [CRON DAY ONE] No missions starting today");
    return {
      success: true,
      captured: 0,
      failed: 0,
      skipped: 0,
      missions: [],
    };
  }

  console.log(`📋 [CRON DAY ONE] Found ${agreements.length} mission(s) starting today`);

  const results = {
    success: true,
    captured: 0,
    failed: 0,
    skipped: 0,
    missions: [],
  };

  // 2) Capturer les paiements du jour 1 pour chaque mission
  for (const agreement of agreements) {
    try {
      console.log(`🔄 [CRON DAY ONE] Processing mission ${agreement.id} (${agreement.title || 'Untitled'})`);

      const result = await captureDayOnePayments(agreement.id);

      if (result.alreadyCaptured) {
        console.log(`⏭️ [CRON DAY ONE] Day one payments already captured for mission ${agreement.id}`);
        results.skipped++;
        results.missions.push({
          id: agreement.id,
          status: "skipped",
          reason: "Already captured",
        });
      } else {
        console.log(`✅ [CRON DAY ONE] Day one payments captured for mission ${agreement.id}: ${result.totalCaptured}€`);
        results.captured++;
        results.missions.push({
          id: agreement.id,
          status: "captured",
          commissionCaptured: result.commissionCaptured,
          depositCaptured: result.depositCaptured,
          totalCaptured: result.totalCaptured,
        });
      }
    } catch (err) {
      console.error(`❌ [CRON DAY ONE] Failed to capture day one payments for mission ${agreement.id}:`, err);
      results.failed++;
      results.missions.push({
        id: agreement.id,
        status: "failed",
        error: err.message,
      });
    }
  }

  console.log(`✅ [CRON DAY ONE] Completed: ${results.captured} captured, ${results.failed} failed, ${results.skipped} skipped`);

  return results;
}
