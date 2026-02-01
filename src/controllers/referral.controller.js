// src/controllers/referral.controller.js
import { getReferralInfo } from "../services/referral.service.js";

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
