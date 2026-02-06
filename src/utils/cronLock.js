// src/utils/cronLock.js
// 🛡️ SÉCURITÉ : Verrou DB pour éviter double exécution des crons en multi-instances

import { supabaseAdmin as supabase } from "../config/supabase.js";
import os from "os";

// Identifiant unique de cette instance (hostname ou dyno id)
const INSTANCE_ID = process.env.DYNO || process.env.HOSTNAME || os.hostname();

/**
 * Acquérir un verrou pour un job cron (leader election)
 * @param {string} jobName - Nom du job (ex: "capture-mission-payments")
 * @param {number} ttlSeconds - Durée du verrou en secondes (défaut: 300 = 5min)
 * @returns {Promise<boolean>} true si verrou acquis, false sinon
 */
export async function acquireCronLock(jobName, ttlSeconds = 300) {
  try {
    const { data, error } = await supabase.rpc("acquire_cron_lock", {
      p_job_name: jobName,
      p_locked_by: INSTANCE_ID,
      p_ttl_seconds: ttlSeconds,
    });

    if (error) {
      console.error(`[CRON LOCK] Error acquiring lock for ${jobName}:`, error);
      return false;
    }

    return data === true;
  } catch (err) {
    console.error(`[CRON LOCK] Exception acquiring lock for ${jobName}:`, err);
    return false;
  }
}

/**
 * Libérer un verrou de job cron
 * @param {string} jobName - Nom du job
 * @returns {Promise<boolean>} true si libéré, false sinon
 */
export async function releaseCronLock(jobName) {
  try {
    const { data, error } = await supabase.rpc("release_cron_lock", {
      p_job_name: jobName,
      p_locked_by: INSTANCE_ID,
    });

    if (error) {
      console.error(`[CRON LOCK] Error releasing lock for ${jobName}:`, error);
      return false;
    }

    return data === true;
  } catch (err) {
    console.error(`[CRON LOCK] Exception releasing lock for ${jobName}:`, err);
    return false;
  }
}

/**
 * Wrapper pour exécuter un job cron avec verrou automatique
 * Usage:
 *   await withCronLock("my-job", async () => {
 *     // ton code de cron ici
 *   });
 * 
 * @param {string} jobName - Nom du job
 * @param {Function} fn - Fonction async à exécuter
 * @param {number} ttlSeconds - Durée du verrou (défaut: 300s)
 * @returns {Promise<{executed: boolean, result?: any, error?: any}>}
 */
export async function withCronLock(jobName, fn, ttlSeconds = 300) {
  const acquired = await acquireCronLock(jobName, ttlSeconds);

  if (!acquired) {
    console.log(`[CRON LOCK] Job ${jobName} already running on another instance. Skipping.`);
    return { executed: false };
  }

  console.log(`[CRON LOCK] Lock acquired for ${jobName} by ${INSTANCE_ID}`);

  try {
    const result = await fn();
    return { executed: true, result };
  } catch (error) {
    console.error(`[CRON LOCK] Job ${jobName} failed:`, error);
    return { executed: true, error };
  } finally {
    await releaseCronLock(jobName);
    console.log(`[CRON LOCK] Lock released for ${jobName}`);
  }
}
