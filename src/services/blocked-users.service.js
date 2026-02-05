// src/services/blocked-users.service.js

import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * Bloquer un utilisateur
 */
export async function blockUser(blockerId, blockedId, reason = null) {
  if (blockerId === blockedId) {
    const error = new Error("Vous ne pouvez pas vous bloquer vous-même");
    error.statusCode = 400;
    throw error;
  }
  
  const { data, error } = await supabase
    .from("blocked_users")
    .insert({
      blocker_id: blockerId,
      blocked_id: blockedId,
      reason
    })
    .select()
    .single();
  
  if (error) {
    // Si déjà bloqué
    if (error.code === "23505") {
      const err = new Error("Utilisateur déjà bloqué");
      err.statusCode = 400;
      throw err;
    }
    throw error;
  }
  
  console.log(`[BLOCKED_USERS] User ${blockerId} blocked user ${blockedId}`);
  
  return data;
}

/**
 * Débloquer un utilisateur
 */
export async function unblockUser(blockerId, blockedId) {
  const { error } = await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);
  
  if (error) throw error;
  
  console.log(`[BLOCKED_USERS] User ${blockerId} unblocked user ${blockedId}`);
  
  return true;
}

/**
 * Liste des utilisateurs bloqués par un user
 */
export async function getBlockedUsers(userId) {
  const { data, error } = await supabase
    .from("blocked_users")
    .select(`
      *,
      blocked_user:blocked_id(id, email)
    `)
    .eq("blocker_id", userId)
    .order("created_at", { ascending: false });
  
  if (error) throw error;
  return data;
}

/**
 * Vérifie si userId a bloqué targetId
 */
export async function isUserBlocked(userId, targetId) {
  const { data, error } = await supabase
    .from("blocked_users")
    .select("id")
    .eq("blocker_id", userId)
    .eq("blocked_id", targetId)
    .maybeSingle();
  
  if (error) return false;
  return !!data;
}

/**
 * Vérifie si deux users se sont bloqués mutuellement (dans un sens ou l'autre)
 */
export async function areUsersMutuallyBlocked(userId1, userId2) {
  const blocked1 = await isUserBlocked(userId1, userId2);
  const blocked2 = await isUserBlocked(userId2, userId1);
  return blocked1 || blocked2;
}

/**
 * Récupère la liste des IDs bloqués par un user (pour filtrage rapide)
 */
export async function getBlockedUserIds(userId) {
  const { data, error } = await supabase
    .from("blocked_users")
    .select("blocked_id")
    .eq("blocker_id", userId);
  
  if (error) return [];
  return data.map(row => row.blocked_id);
}
