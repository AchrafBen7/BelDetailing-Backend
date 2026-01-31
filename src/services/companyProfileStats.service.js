// src/services/companyProfileStats.service.js
// Calcule les métriques fiabilité / historique pour le profil Company (à la volée pour GET /profile).

import { supabaseAdmin as supabase } from "../config/supabase.js";

const PAYMENT_SUCCESS_STATUSES = ["succeeded", "captured", "transferred", "captured_held"];

/**
 * Récupère les métriques de fiabilité et d'historique pour une company (user_id).
 * Utilisé dans getProfile pour enrichir le DTO companyProfile.
 *
 * @param {string} companyUserId - user_id de la company (users.id)
 * @returns {Promise<Object>} { missionsPostedCount, missionsCompletedCount, paymentSuccessRate, lateCancellationsCount, openDisputesCount, detailerSatisfactionRate, detailerRating }
 */
export async function getCompanyReliabilityMetrics(companyUserId) {
  const result = {
    missionsPostedCount: 0,
    missionsCompletedCount: 0,
    paymentSuccessRate: null,
    lateCancellationsCount: 0,
    openDisputesCount: 0,
    detailerSatisfactionRate: null,
    detailerRating: null,
  };

  // 1) Nombre d'offres postées (missions postées)
  const { count: offersCount, error: offersError } = await supabase
    .from("offers")
    .select("id", { count: "exact", head: true })
    .eq("created_by", companyUserId);

  if (!offersError) {
    result.missionsPostedCount = offersCount ?? 0;
  }

  // 2) Nombre de missions complétées (mission_agreements avec status = completed)
  const { count: completedCount, error: completedError } = await supabase
    .from("mission_agreements")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyUserId)
    .eq("status", "completed");

  if (!completedError) {
    result.missionsCompletedCount = completedCount ?? 0;
  }

  // 3) Taux de paiement réussi (mission_payments liés aux agreements de cette company)
  const { data: agreementIds, error: agreementsError } = await supabase
    .from("mission_agreements")
    .select("id")
    .eq("company_id", companyUserId);

  if (!agreementsError && agreementIds?.length > 0) {
    const ids = agreementIds.map((a) => a.id);

    const { data: payments, error: paymentsError } = await supabase
      .from("mission_payments")
      .select("id, status")
      .in("mission_agreement_id", ids);

    if (!paymentsError && payments?.length > 0) {
      const total = payments.length;
      const success = payments.filter((p) => PAYMENT_SUCCESS_STATUSES.includes(p.status)).length;
      result.paymentSuccessRate = total > 0 ? Math.round((success / total) * 10000) / 10000 : 1;
    } else if (!paymentsError && payments?.length === 0) {
      result.paymentSuccessRate = 1; // Aucun paiement = pas d'échec
    }
  }

  // 4) Annulations tardives : company a annulé après que le detailer a accepté
  const { data: cancelledByCompany, error: cancelledError } = await supabase
    .from("mission_agreements")
    .select("id, cancellation_requested_at, detailer_accepted_at")
    .eq("company_id", companyUserId)
    .eq("status", "cancelled")
    .eq("cancellation_requested_by", "company");

  if (!cancelledError && cancelledByCompany?.length > 0) {
    const late = cancelledByCompany.filter((row) => {
      const requestedAt = row.cancellation_requested_at ? new Date(row.cancellation_requested_at).getTime() : null;
      const acceptedAt = row.detailer_accepted_at ? new Date(row.detailer_accepted_at).getTime() : null;
      return requestedAt != null && acceptedAt != null && requestedAt > acceptedAt;
    });
    result.lateCancellationsCount = late.length;
  }

  // 5) Avis detailers sur la company (company_reviews) : note moyenne et taux de satisfaction
  try {
    const { data: reviews, error: reviewsError } = await supabase
      .from("company_reviews")
      .select("rating")
      .eq("company_id", companyUserId);

    if (!reviewsError && reviews?.length > 0) {
      const sum = reviews.reduce((acc, r) => acc + (Number(r.rating) || 0), 0);
      result.detailerRating = Math.round((sum / reviews.length) * 100) / 100;
      const satisfied = reviews.filter((r) => (Number(r.rating) || 0) >= 4).length;
      result.detailerSatisfactionRate = Math.round((satisfied / reviews.length) * 10000) / 10000;
    }
  } catch (_) {
    // Table company_reviews peut ne pas exister encore (migration non exécutée)
  }

  return result;
}
