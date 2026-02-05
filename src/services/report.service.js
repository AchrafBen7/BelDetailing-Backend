// src/services/report.service.js

import { supabaseAdmin as supabase } from "../config/supabase.js";

const VALID_CONTENT_TYPES = ["review", "message", "profile", "offer", "application"];
const VALID_REASONS = ["inappropriate", "harassment", "spam", "false_info", "other"];

/**
 * Crée un signalement de contenu
 */
export async function createReport({
  reporterId,
  reportedUserId,
  contentType,
  contentId,
  reason,
  description
}) {
  // Validation
  if (!VALID_CONTENT_TYPES.includes(contentType)) {
    const error = new Error(`Invalid content type. Must be one of: ${VALID_CONTENT_TYPES.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
  
  if (!VALID_REASONS.includes(reason)) {
    const error = new Error(`Invalid reason. Must be one of: ${VALID_REASONS.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
  
  // Vérifier que le contenu existe
  const contentExists = await verifyContentExists(contentType, contentId);
  if (!contentExists) {
    const error = new Error("Content not found");
    error.statusCode = 404;
    throw error;
  }
  
  // Vérifier qu'on ne se signale pas soi-même (via reported_user_id si fourni)
  if (reportedUserId && reportedUserId === reporterId) {
    const error = new Error("Vous ne pouvez pas vous signaler vous-même");
    error.statusCode = 400;
    throw error;
  }
  
  // Créer le signalement
  const { data, error } = await supabase
    .from("content_reports")
    .insert({
      reporter_id: reporterId,
      reported_user_id: reportedUserId || null,
      content_type: contentType,
      content_id: contentId,
      reason,
      description: description || null,
      status: "pending"
    })
    .select()
    .single();
  
  if (error) {
    // Si duplicate (déjà signalé par ce user)
    if (error.code === "23505") {
      const err = new Error("Vous avez déjà signalé ce contenu");
      err.statusCode = 400;
      throw err;
    }
    throw error;
  }
  
  // Notification aux admins (simple console.log pour le moment)
  console.log(`[REPORT] New report created by ${reporterId} for ${contentType} ${contentId}`);
  
  return data;
}

/**
 * Vérifie que le contenu existe
 */
async function verifyContentExists(contentType, contentId) {
  let table;
  switch (contentType) {
    case "review": table = "reviews"; break;
    case "message": table = "messages"; break;
    case "profile": table = "users"; break;
    case "offer": table = "offers"; break;
    case "application": table = "applications"; break;
    default: return false;
  }
  
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", contentId)
    .maybeSingle();
  
  return !error && !!data;
}

/**
 * Liste les signalements (pour dashboard admin)
 */
export async function getReports({ status, contentType, limit = 50 }) {
  let query = supabase
    .from("content_reports")
    .select(`
      *,
      reporter:reporter_id(id, email),
      reported_user:reported_user_id(id, email)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);
  
  if (status) {
    query = query.eq("status", status);
  }
  
  if (contentType) {
    query = query.eq("content_type", contentType);
  }
  
  const { data, error } = await query;
  if (error) throw error;
  
  return data;
}

/**
 * Mes signalements (user)
 */
export async function getMyReports(userId) {
  const { data, error } = await supabase
    .from("content_reports")
    .select("*")
    .eq("reporter_id", userId)
    .order("created_at", { ascending: false });
  
  if (error) throw error;
  return data;
}

/**
 * Détail d'un signalement (admin)
 */
export async function getReportById(reportId) {
  const { data, error } = await supabase
    .from("content_reports")
    .select(`
      *,
      reporter:reporter_id(id, email),
      reported_user:reported_user_id(id, email)
    `)
    .eq("id", reportId)
    .single();
  
  if (error) throw error;
  return data;
}

/**
 * Mettre à jour le status d'un signalement (admin)
 */
export async function updateReportStatus(reportId, status, actionTaken = null) {
  const validStatuses = ["pending", "reviewed", "actioned", "dismissed"];
  
  if (!validStatuses.includes(status)) {
    const error = new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
  
  const { data, error } = await supabase
    .from("content_reports")
    .update({
      status,
      action_taken: actionTaken,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", reportId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}
