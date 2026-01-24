// src/cron/releaseDepositsAtJPlusOne.js
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { releaseDepositAtJPlusOne } from "../services/missionPaymentReleaseDeposit.service.js";

/**
 * 🟦 RELEASE DEPOSITS AT J+1 CRON – Libérer automatiquement les acomptes à J+1
 * 
 * Cette fonction est appelée par un cron job (ex: toutes les heures) pour libérer
 * les acomptes capturés (statut "captured_held") pour les missions dont le startDate
 * était hier (J+1 = jour après le premier jour de mission).
 * 
 * @param {string|null} date - Date au format YYYY-MM-DD (optionnel, défaut: aujourd'hui)
 * @returns {Promise<Object>} Résultat avec statistiques
 */
export async function releaseDepositsAtJPlusOneCron(date = null) {
  const today = date ? new Date(date) : new Date();
  today.setHours(0, 0, 0, 0);
  
  // J+1 = hier (startDate était hier, donc aujourd'hui on libère l'acompte)
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayString = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

  console.log(`🔄 [CRON J+1] Releasing deposits for missions that started on: ${yesterdayString} (J+1 release)`);

  // 1) Récupérer les missions actives dont le startDate était hier
  const { data: agreements, error } = await supabase
    .from("mission_agreements")
    .select("*")
    .eq("status", "active")
    .gte("start_date", yesterdayString)
    .lt("start_date", today.toISOString().split('T')[0]);

  if (error) {
    console.error("❌ [CRON J+1] Error fetching missions:", error);
    throw error;
  }

  if (!agreements || agreements.length === 0) {
    console.log("ℹ️ [CRON J+1] No missions to process (no missions started yesterday)");
    return {
      success: true,
      released: 0,
      failed: 0,
      skipped: 0,
      missions: [],
    };
  }

  console.log(`📋 [CRON J+1] Found ${agreements.length} mission(s) to process`);

  const results = {
    success: true,
    released: 0,
    failed: 0,
    skipped: 0,
    missions: [],
  };

  // 2) Libérer les acomptes pour chaque mission
  for (const agreement of agreements) {
    try {
      console.log(`🔄 [CRON J+1] Processing mission ${agreement.id} (${agreement.title || 'Untitled'})`);

      const result = await releaseDepositAtJPlusOne(agreement.id);

      if (result.alreadyReleased) {
        console.log(`⏭️ [CRON J+1] Deposit already released for mission ${agreement.id}`);
        results.skipped++;
        results.missions.push({
          id: agreement.id,
          status: "skipped",
          reason: "Already released",
        });
      } else {
        console.log(`✅ [CRON J+1] Deposit released for mission ${agreement.id}: ${result.amount}€`);
        results.released++;
        results.missions.push({
          id: agreement.id,
          status: "released",
          amount: result.amount,
          transferId: result.transferId || result.id,
        });
      }
    } catch (err) {
      console.error(`❌ [CRON J+1] Failed to release deposit for mission ${agreement.id}:`, err);
      results.failed++;
      results.missions.push({
        id: agreement.id,
        status: "failed",
        error: err.message,
      });
    }
  }

  console.log(`✅ [CRON J+1] Completed: ${results.released} released, ${results.failed} failed, ${results.skipped} skipped`);

  return results;
}
