// src/controllers/referral.controller.js
import { getReferralInfo, getReferralPlatformStats } from "../services/referral.service.js";

/**
 * GET /api/v1/referral/info
 * Infos parrainage pour l'utilisateur connecté: mon code, mon lien, mes stats (invités en attente / validés)
 */
export async function getReferralInfoController(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const info = await getReferralInfo(userId);
    if (!info) {
      return res.status(404).json({ error: "Referral info not found" });
    }

    return res.json(info);
  } catch (err) {
    console.error("[REFERRAL] getReferralInfo error:", err);
    return res.status(500).json({ error: "Could not fetch referral info" });
  }
}

/**
 * GET /api/v1/referral/stats
 * Métriques plateforme parrainage (total referrals, pending, validated, signups 30j, conversion rate)
 */
export async function getReferralStatsController(req, res) {
  try {
    const stats = await getReferralPlatformStats();
    return res.json(stats);
  } catch (err) {
    console.error("[REFERRAL] getReferralPlatformStats error:", err);
    return res.status(500).json({ error: "Could not fetch referral stats" });
  }
}
