// src/services/companyReview.service.js
// Création / mise à jour d'un avis detailer sur une company (company_reviews).

import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * Crée ou met à jour l'avis d'un detailer sur une company.
 * Un seul avis par (detailer_id, company_id) : upsert sur conflit.
 *
 * @param {string} detailerUserId - user_id du detailer (req.user.id)
 * @param {string} companyUserId - user_id de la company
 * @param {number} rating - note 1–5
 * @param {string} [comment] - commentaire optionnel
 * @param {string} [missionAgreementId] - mission liée (optionnel)
 * @returns {Promise<Object>} { id, rating, comment, created_at }
 */
export async function createOrUpdateCompanyReview(detailerUserId, companyUserId, rating, comment, missionAgreementId) {
  if (!rating || rating < 1 || rating > 5) {
    const err = new Error("Rating must be between 1 and 5");
    err.statusCode = 400;
    throw err;
  }

  // 🔒 SECURITY: Limiter la longueur du commentaire
  if (comment && typeof comment === "string" && comment.length > 2000) {
    const err = new Error("Comment too long (max 2000 characters)");
    err.statusCode = 400;
    throw err;
  }

  // 🔒 SECURITY: Vérifier que le detailer a une relation de mission avec cette company
  // Le detailer ne peut noter que les companies avec qui il a travaillé
  const { data: missions, error: missionErr } = await supabase
    .from("mission_agreements")
    .select("id, status")
    .eq("provider_id", detailerUserId)
    .eq("company_id", companyUserId)
    .in("status", ["active", "completed"])
    .limit(1);

  if (missionErr) throw missionErr;

  if (!missions || missions.length === 0) {
    const err = new Error("You can only review companies you have worked with (active or completed mission required)");
    err.statusCode = 403;
    throw err;
  }

  // Si un missionAgreementId spécifique est fourni, vérifier qu'il appartient bien à cette relation
  if (missionAgreementId) {
    const validMission = missions.find(m => m.id === missionAgreementId);
    if (!validMission) {
      const err = new Error("The specified mission does not belong to this company/detailer relationship");
      err.statusCode = 400;
      throw err;
    }
  }

  const { data, error } = await supabase
    .from("company_reviews")
    .upsert(
      {
        detailer_id: detailerUserId,
        company_id: companyUserId,
        mission_agreement_id: missionAgreementId || null,
        rating: Math.round(Number(rating)),
        comment: comment?.trim() || null,
      },
      {
        onConflict: "detailer_id,company_id",
      }
    )
    .select("id, rating, comment, created_at")
    .single();

  if (error) {
    if (error.code === "23503") {
      const err = new Error("Company or mission not found");
      err.statusCode = 404;
      throw err;
    }
    throw error;
  }

  return data;
}

/**
 * Liste les avis reçus par une company (pour affichage profil company).
 *
 * @param {string} companyUserId - user_id de la company
 * @returns {Promise<Array<{ id, rating, comment, created_at, detailerDisplayName? }>>}
 */
export async function listCompanyReviews(companyUserId) {
  const { data, error } = await supabase
    .from("company_reviews")
    .select(`
      id,
      rating,
      comment,
      created_at,
      detailer_id
    `)
    .eq("company_id", companyUserId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  if (!data?.length) return [];

  const detailerIds = [...new Set(data.map((r) => r.detailer_id).filter(Boolean))];
  let displayNamesMap = new Map();

  if (detailerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("provider_profiles")
      .select("user_id, display_name")
      .in("user_id", detailerIds);
    (profiles || []).forEach((p) => displayNamesMap.set(p.user_id, p.display_name || "—"));
  }

  return data.map((row) => ({
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    detailerDisplayName: displayNamesMap.get(row.detailer_id) ?? null,
  }));
}
