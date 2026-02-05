// src/controllers/blocked-users.controller.js

import { blockUser, unblockUser, getBlockedUsers } from "../services/blocked-users.service.js";

/**
 * POST /api/v1/users/:userId/block
 * Bloquer un utilisateur
 */
export async function blockUserController(req, res) {
  try {
    const blockerId = req.user?.id;
    if (!blockerId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const { userId } = req.params;
    const { reason } = req.body;
    
    const result = await blockUser(blockerId, userId, reason);
    
    return res.status(201).json({
      success: true,
      message: "Utilisateur bloqué",
      data: result
    });
  } catch (err) {
    console.error("[BLOCKED_USERS] block error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message });
  }
}

/**
 * DELETE /api/v1/users/:userId/unblock
 * Débloquer un utilisateur
 */
export async function unblockUserController(req, res) {
  try {
    const blockerId = req.user?.id;
    if (!blockerId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const { userId } = req.params;
    
    await unblockUser(blockerId, userId);
    
    return res.json({
      success: true,
      message: "Utilisateur débloqué"
    });
  } catch (err) {
    console.error("[BLOCKED_USERS] unblock error:", err);
    return res.status(500).json({ error: "Could not unblock user" });
  }
}

/**
 * GET /api/v1/users/blocked
 * Liste des utilisateurs bloqués
 */
export async function getBlockedUsersController(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const blockedUsers = await getBlockedUsers(userId);
    return res.json({ data: blockedUsers });
  } catch (err) {
    console.error("[BLOCKED_USERS] list error:", err);
    return res.status(500).json({ error: "Could not fetch blocked users" });
  }
}
