// src/jobs/missionConfirmationTimeout.js
/**
 * Cron Job: Auto-cancel missions where one party hasn't confirmed start within 48h.
 * Also handles: auto-complete missions past end date if one party confirmed end.
 * 
 * Runs every 6 hours.
 */
import cron from "node-cron";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { withCronLock } from "../utils/cronLock.js";

async function checkMissionConfirmationTimeouts() {
  console.log("[CRON] Checking mission confirmation timeouts...");
  const now = new Date();

  // ============================================================
  // 1. Auto-cancel missions in "awaiting_start" for > 48h
  // If one party confirmed but the other hasn't within 48h, auto-cancel
  // ============================================================
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  const { data: staleStartMissions, error: staleStartErr } = await supabase
    .from("mission_agreements")
    .select("id, title, company_id, detailer_id, company_confirmed_start_at, detailer_confirmed_start_at")
    .eq("status", "awaiting_start")
    .lt("updated_at", fortyEightHoursAgo);

  if (staleStartErr) {
    console.error("[CRON] Error fetching stale awaiting_start missions:", staleStartErr);
  } else if (staleStartMissions && staleStartMissions.length > 0) {
    for (const mission of staleStartMissions) {
      console.log(`[CRON] Auto-cancelling awaiting_start mission ${mission.id} (timeout 48h)`);

      const whoDidntConfirm = !mission.company_confirmed_start_at ? "company" : "detailer";

      await supabase
        .from("mission_agreements")
        .update({
          status: "cancelled",
          cancellation_requested_at: now.toISOString(),
          cancellation_requested_by: "system",
          updated_at: now.toISOString(),
        })
        .eq("id", mission.id);

      // Put payments on hold
      await supabase
        .from("mission_payments")
        .update({ status: "cancelled", updated_at: now.toISOString() })
        .eq("mission_agreement_id", mission.id)
        .in("status", ["pending", "authorized"]);

      // Log
      await supabase.from("mission_confirmation_logs").insert({
        mission_agreement_id: mission.id,
        action: "auto_cancel_timeout",
        actor_id: mission.company_id, // System action, use company_id as reference
        actor_role: "system",
        previous_status: "awaiting_start",
        new_status: "cancelled",
        metadata: { reason: `Timeout: ${whoDidntConfirm} did not confirm start within 48h` },
      });

      // Notify both parties
      try {
        const { sendNotificationWithDeepLink } = await import("../services/onesignal.service.js");
        
        await sendNotificationWithDeepLink({
          userId: mission.company_id,
          title: "Mission annulée (timeout)",
          message: `La mission "${mission.title || ""}" a été annulée car le démarrage n'a pas été confirmé dans les 48h.`,
          type: "mission_cancelled_timeout",
          id: mission.id,
        });

        await sendNotificationWithDeepLink({
          userId: mission.detailer_id,
          title: "Mission annulée (timeout)",
          message: `La mission "${mission.title || ""}" a été annulée car le démarrage n'a pas été confirmé dans les 48h.`,
          type: "mission_cancelled_timeout",
          id: mission.id,
        });
      } catch (notifErr) {
        console.error("[CRON] Notification error:", notifErr);
      }
    }
    console.log(`[CRON] Auto-cancelled ${staleStartMissions.length} stale awaiting_start missions`);
  }

  // ============================================================
  // 2. Reminder for "payment_scheduled" missions past start date
  // If start date has passed but no one confirmed start yet
  // ============================================================
  const todayStr = now.toISOString().split("T")[0];

  const { data: pastStartMissions, error: pastStartErr } = await supabase
    .from("mission_agreements")
    .select("id, title, company_id, detailer_id, start_date")
    .eq("status", "payment_scheduled")
    .lt("start_date", todayStr);

  if (!pastStartErr && pastStartMissions && pastStartMissions.length > 0) {
    for (const mission of pastStartMissions) {
      // Check if start date was more than 3 days ago → auto-cancel
      const startDate = new Date(mission.start_date);
      const daysPast = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));

      if (daysPast > 3) {
        console.log(`[CRON] Auto-cancelling payment_scheduled mission ${mission.id} (start date ${daysPast} days ago, no confirmation)`);

        await supabase
          .from("mission_agreements")
          .update({
            status: "cancelled",
            cancellation_requested_at: now.toISOString(),
            cancellation_requested_by: "system",
            updated_at: now.toISOString(),
          })
          .eq("id", mission.id);

        await supabase
          .from("mission_payments")
          .update({ status: "cancelled", updated_at: now.toISOString() })
          .eq("mission_agreement_id", mission.id)
          .in("status", ["pending", "authorized"]);
      } else {
        // Send reminder notification
        try {
          const { sendNotificationWithDeepLink } = await import("../services/onesignal.service.js");
          
          await sendNotificationWithDeepLink({
            userId: mission.company_id,
            title: "Rappel : confirmez le démarrage",
            message: `La date de début de "${mission.title || "votre mission"}" est passée. Veuillez confirmer le démarrage.`,
            type: "mission_start_reminder",
            id: mission.id,
          });

          await sendNotificationWithDeepLink({
            userId: mission.detailer_id,
            title: "Rappel : confirmez le démarrage",
            message: `La date de début de "${mission.title || "votre mission"}" est passée. Veuillez confirmer le démarrage.`,
            type: "mission_start_reminder",
            id: mission.id,
          });
        } catch (notifErr) {
          console.error("[CRON] Reminder notification error:", notifErr);
        }
      }
    }
  }

  // ============================================================
  // 3. Auto-complete "awaiting_end" missions after 7 days
  // If one party confirmed end but the other didn't respond in 7 days
  // ============================================================
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: staleEndMissions, error: staleEndErr } = await supabase
    .from("mission_agreements")
    .select("id, title, company_id, detailer_id")
    .eq("status", "awaiting_end")
    .lt("updated_at", sevenDaysAgo);

  if (!staleEndErr && staleEndMissions && staleEndMissions.length > 0) {
    for (const mission of staleEndMissions) {
      console.log(`[CRON] Auto-completing awaiting_end mission ${mission.id} (timeout 7 days)`);

      await supabase
        .from("mission_agreements")
        .update({
          status: "completed",
          company_confirmed_end_at: now.toISOString(),
          detailer_confirmed_end_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", mission.id);

      await supabase.from("mission_confirmation_logs").insert({
        mission_agreement_id: mission.id,
        action: "auto_complete_timeout",
        actor_id: mission.company_id,
        actor_role: "system",
        previous_status: "awaiting_end",
        new_status: "completed",
        metadata: { reason: "Timeout: other party did not confirm end within 7 days" },
      });
    }
    console.log(`[CRON] Auto-completed ${staleEndMissions.length} stale awaiting_end missions`);
  }

  console.log("[CRON] Mission confirmation timeout check completed.");
}

// Schedule: every 6 hours
export function startMissionConfirmationTimeoutCron() {
  cron.schedule("0 */6 * * *", async () => {
    await withCronLock("mission_confirmation_timeout", async () => {
      await checkMissionConfirmationTimeouts();
    });
  }, {
    timezone: "Europe/Brussels",
  });
  console.log("[CRON] Mission confirmation timeout cron scheduled (every 6h)");
}

export { checkMissionConfirmationTimeouts };
