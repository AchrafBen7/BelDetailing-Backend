// src/controllers/referral.controller.js
import { getReferralInfo, getReferralPlatformStats, applyReferralCode } from "../services/referral.service.js";

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
    // 🔒 SECURITY: Les stats de la plateforme ne sont accessibles qu'aux admins
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const stats = await getReferralPlatformStats();
    return res.json(stats);
  } catch (err) {
    console.error("[REFERRAL] getReferralPlatformStats error:", err);
    return res.status(500).json({ error: "Could not fetch referral stats" });
  }
}

/**
 * POST /api/v1/referral/apply-code
 * Applique un code de parrainage APRÈS inscription (si oublié lors du signup)
 * Body: { referralCode: "ABC123XY" }
 */
export async function applyReferralCodeController(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { referralCode } = req.body;
    if (!referralCode || typeof referralCode !== "string") {
      return res.status(400).json({ error: "Missing or invalid referralCode" });
    }

    const result = await applyReferralCode(userId, referralCode);
    return res.json(result);
  } catch (err) {
    console.error("[REFERRAL] applyReferralCode error:", err);
    const status = err.statusCode || 500;
    const message = err.message || "Could not apply referral code";
    return res.status(status).json({ error: message });
  }
}
