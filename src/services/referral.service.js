// src/services/referral.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

const REFERRAL_CODE_LENGTH = 8;
const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O, 1/I pour lisibilité

/** Nombre de missions complétées par le detailer filleul pour valider le parrainage (Phase 1) */
const REFERRAL_PROVIDER_MISSIONS_REQUIRED = 3;

/** Filleul reçoit toujours le niveau 1 (3€ crédit à l'inscription) */
const REFERRAL_FILLEUL_CREDIT_EUR = 3;

/**
 * Système de parrainage NIOS — Niveaux 1 → 10
 * Le parrain progresse niveau par niveau ; déblocage = 1 filleul validé (1ère résa payée).
 * rewardType: "credit" = cash crédit, "advantage" = Service Boost / option, "status" = Badge, "jackpot" = Service gratuit
 */
const REFERRAL_LEVELS = [
  { level: 1, invitesRequired: 1, rewardType: "credit", rewardValue: 3, rewardDescription: "+3€ crédit" },
  { level: 2, invitesRequired: 2, rewardType: "credit", rewardValue: 3, rewardDescription: "+3€ crédit" },
  { level: 3, invitesRequired: 3, rewardType: "credit", rewardValue: 5, rewardDescription: "+5€ crédit" },
  { level: 4, invitesRequired: 4, rewardType: "advantage", rewardValue: 0, rewardDescription: "🎁 Service Boost" },
  { level: 5, invitesRequired: 5, rewardType: "credit", rewardValue: 10, rewardDescription: "+10€ crédit" },
  { level: 6, invitesRequired: 6, rewardType: "advantage", rewardValue: 0, rewardDescription: "🎁 Service Boost x2" },
  { level: 7, invitesRequired: 7, rewardType: "status", rewardValue: 0, rewardDescription: "⭐ Badge Ambassadeur NIOS" },
  { level: 8, invitesRequired: 8, rewardType: "credit", rewardValue: 15, rewardDescription: "+15€ crédit" },
  { level: 9, invitesRequired: 9, rewardType: "advantage", rewardValue: 0, rewardDescription: "🎁 Option premium offerte" },
  { level: 10, invitesRequired: 10, rewardType: "jackpot", rewardValue: 85, rewardDescription: "🎉 Service gratuit (max 85€)" },
];

/**
 * Génère un code de parrainage (ex: ABC123XY)
 */
export function generateReferralCode() {
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_CODE_ALPHABET[Math.floor(Math.random() * REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Crée ou récupère le referral_code d'un user (pour backfill ou nouveau user)
 */
export async function ensureUserReferralCode(userId) {
  const { data: user, error: fetchError } = await supabase
    .from("users")
    .select("referral_code")
    .eq("id", userId)
    .single();

  if (fetchError) throw fetchError;
  if (user?.referral_code) return user.referral_code;

  let code;
  let attempts = 0;
  const maxAttempts = 10;
  do {
    code = generateReferralCode();
    const { error: updateError } = await supabase
      .from("users")
      .update({ referral_code: code })
      .eq("id", userId);
    if (!updateError) return code;
    if (updateError?.code !== "23505") throw updateError; // 23505 = unique violation
    attempts++;
  } while (attempts < maxAttempts);
  throw new Error("Could not generate unique referral code");
}

/**
 * Valide le code de parrainage pour l'inscription (Phase 1: même rôle que le parrain)
 * @returns { referrerId, referrerRole } ou null si invalide
 */
export async function validateReferralCodeForSignup(referralCode, newUserRole) {
  if (!referralCode || typeof referralCode !== "string") return null;
  const code = referralCode.trim().toUpperCase();
  if (!code) return null;

  const { data: referrer, error } = await supabase
    .from("users")
    .select("id, role")
    .eq("referral_code", code)
    .maybeSingle();

  if (error || !referrer) return null;

  // Phase 1: Customer → Customer, Detailer → Detailer (provider ou provider_passionate)
  const referrerIsDetailer =
    referrer.role === "provider" || referrer.role === "provider_passionate";
  const newIsDetailer =
    newUserRole === "provider" || newUserRole === "provider_passionate";
  if (referrerIsDetailer !== newIsDetailer) return null;
  if (referrer.role === "company" || newUserRole === "company") return null; // Phase 1: pas company

  return { referrerId: referrer.id, referrerRole: referrer.role };
}

const MAX_PENDING_REFERRALS_PER_24H = 20;

/**
 * Nombre de referrals pending créés par ce parrain dans les dernières 24h (anti-fraude)
 */
export async function getPendingReferralsCountLast24h(referrerId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("referrer_id", referrerId)
    .eq("status", "pending")
    .gte("created_at", since);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Crée l'entrée referral (pending) après inscription (avec limite anti-fraude)
 */
export async function createPendingReferral(referrerId, referredId, roleType) {
  try {
    const count = await getPendingReferralsCountLast24h(referrerId);
    if (count >= MAX_PENDING_REFERRALS_PER_24H) {
      const err = new Error("Referral limit exceeded (too many pending invites in 24h)");
      err.statusCode = 429;
      throw err;
    }
  } catch (e) {
    if (e.statusCode === 429) throw e;
    console.warn("[REFERRAL] getPendingReferralsCountLast24h failed (e.g. no created_at), skipping limit:", e.message);
  }
  const { error } = await supabase.from("referrals").insert({
    referrer_id: referrerId,
    referred_id: referredId,
    role_type: roleType,
    status: "pending",
  });
  if (error) throw error;
}

/**
 * Vérifie si l'utilisateur a déjà un parrain (un seul referral par user)
 */
export async function userAlreadyReferred(referredId) {
  const { data, error } = await supabase
    .from("referrals")
    .select("id")
    .eq("referred_id", referredId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * Infos parrainage pour l'utilisateur connecté (mon lien, mes stats)
 */
export async function getReferralInfo(userId) {
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("referral_code, referred_by")
    .eq("id", userId)
    .single();
  if (userError || !user) return null;

  let referralCode = user.referral_code;
  if (!referralCode) {
    try {
      referralCode = await ensureUserReferralCode(userId);
    } catch (e) {
      console.warn("[REFERRAL] ensureUserReferralCode failed:", e.message);
    }
  }

  const baseUrl = process.env.FRONTEND_BASE_URL || "https://nios.app";
  const inviteLink = referralCode ? `${baseUrl}/invite/${referralCode}` : null;

  const { data: asReferrer } = await supabase
    .from("referrals")
    .select("id, status, created_at")
    .eq("referrer_id", userId);

  const pending = (asReferrer || []).filter((r) => r.status === "pending").length;
  const validated = (asReferrer || []).filter((r) => r.status === "validated").length;

  // Niveaux 1 à 10 (système parrainage NIOS) – récompense par niveau
  const tiers = REFERRAL_LEVELS.map((row) => ({
    level: row.level,
    invitesRequired: row.invitesRequired,
    rewardDescription: row.rewardDescription,
    rewardType: row.rewardType,
    reached: validated >= row.invitesRequired,
  }));
  const nextTierAt = REFERRAL_LEVELS.find((r) => r.invitesRequired > validated)?.invitesRequired ?? null;

  return {
    referralCode: referralCode || null,
    inviteLink,
    referredBy: user.referred_by || null,
    stats: {
      pendingInvites: pending,
      validatedInvites: validated,
      totalInvites: (asReferrer || []).length,
    },
    tiers,
    nextTierAt,
  };
}

/**
 * À appeler après chaque mise à jour d'un booking en payment_status = paid.
 * Si c'est la première résa payée du customer, valide le parrainage et attribue la récompense.
 */
export async function tryValidateReferralCustomerFirstPaidBooking(customerId) {
  const { count, error } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("payment_status", "paid");
  if (error || count !== 1) return;
  await validateReferralCustomer(customerId);
}

/**
 * Marque un referral comme validé et enregistre la récompense (Customer: 1ère résa payée).
 * Le parrain progresse niveau par niveau ; la récompense dépend du niveau atteint (1→10).
 */
export async function validateReferralCustomer(referredUserId) {
  const { data: ref, error: fetchError } = await supabase
    .from("referrals")
    .select("id, referrer_id")
    .eq("referred_id", referredUserId)
    .eq("status", "pending")
    .maybeSingle();
  if (fetchError || !ref) return;

  // Nombre de filleuls déjà validés par ce parrain (avant ce referral)
  const { data: existingValidated } = await supabase
    .from("referrals")
    .select("id")
    .eq("referrer_id", ref.referrer_id)
    .eq("status", "validated");
  const validatedCount = (existingValidated || []).length;
  const newLevel = validatedCount + 1; // 1-based level just reached

  const levelConfig = REFERRAL_LEVELS.find((r) => r.level === newLevel);
  const rewardType = levelConfig?.rewardType ?? "credit";
  const rewardValue = levelConfig?.rewardValue ?? 3;

  const { error: updateError } = await supabase
    .from("referrals")
    .update({
      status: "validated",
      validated_at: new Date().toISOString(),
      reward_type: rewardType,
      reward_value: rewardValue,
    })
    .eq("id", ref.id);
  if (updateError) {
    console.error("[REFERRAL] validateReferralCustomer update error:", updateError);
    return;
  }

  // Crédit parrain : uniquement pour rewardType "credit" ou "jackpot" (valeur en €)
  const creditToAdd = (rewardType === "credit" || rewardType === "jackpot") ? Number(rewardValue) : 0;
  if (creditToAdd > 0) {
    const { data: u } = await supabase.from("users").select("customer_credits_eur").eq("id", ref.referrer_id).single();
    const current = Number(u?.customer_credits_eur ?? 0) || 0;
    await supabase.from("users").update({ customer_credits_eur: current + creditToAdd }).eq("id", ref.referrer_id);
    console.log(`[REFERRAL] Validated customer referral ${ref.id}, referrer ${ref.referrer_id} level ${newLevel} gets ${creditToAdd}€ credit (${levelConfig?.rewardDescription})`);
  } else {
    console.log(`[REFERRAL] Validated customer referral ${ref.id}, referrer ${ref.referrer_id} level ${newLevel} gets ${levelConfig?.rewardDescription} (no cash)`);
  }
}

/**
 * À appeler après chaque complétion d'un booking (status = completed) par un provider.
 * Si le provider filleul atteint X missions complétées, valide le parrainage et attribue la récompense au parrain.
 */
export async function tryValidateReferralProviderWhenMissionsCompleted(providerUserId) {
  const { count, error } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("provider_id", providerUserId)
    .eq("status", "completed");
  if (error || count < REFERRAL_PROVIDER_MISSIONS_REQUIRED) return;
  await validateReferralProvider(providerUserId);
}

/**
 * Marque un referral comme validé (Detailer: X missions terminées)
 */
export async function validateReferralProvider(referredUserId) {
  const { data: ref, error: fetchError } = await supabase
    .from("referrals")
    .select("id, referrer_id")
    .eq("referred_id", referredUserId)
    .eq("status", "pending")
    .maybeSingle();
  if (fetchError || !ref) return;

  const rewardType = "commission_reduction";
  const rewardValue = 0.5; // -0.5% commission (1 mois)
  const { error: updateError } = await supabase
    .from("referrals")
    .update({
      status: "validated",
      validated_at: new Date().toISOString(),
      reward_type: rewardType,
      reward_value: rewardValue,
    })
    .eq("id", ref.id);
  if (updateError) {
    console.error("[REFERRAL] validateReferralProvider update error:", updateError);
    return;
  }
  console.log(`[REFERRAL] Validated provider referral ${ref.id}, referrer ${ref.referrer_id} gets ${rewardValue}% commission reduction`);
}

/**
 * Applique un code de parrainage APRÈS inscription (si l'utilisateur a oublié lors du signup)
 * Conditions:
 * - L'utilisateur ne doit pas déjà avoir un parrain
 * - Le code doit être valide
 * - Les rôles doivent correspondre (customer→customer, provider→provider)
 * - L'utilisateur ne doit pas avoir déjà payé de réservation (customer) ou complété de mission (provider)
 */
export async function applyReferralCode(userId, referralCode) {
  // 1. Vérifier que l'utilisateur n'a pas déjà un parrain
  const alreadyReferred = await userAlreadyReferred(userId);
  if (alreadyReferred) {
    const err = new Error("You already have a referrer");
    err.statusCode = 400;
    throw err;
  }

  // 2. Récupérer l'utilisateur courant
  const { data: currentUser, error: userError } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", userId)
    .single();

  if (userError || !currentUser) {
    const err = new Error("User not found");
    err.statusCode = 404;
    throw err;
  }

  // 3. Valider le code de parrainage
  const validation = await validateReferralCodeForSignup(referralCode, currentUser.role);
  if (!validation) {
    const err = new Error("Invalid referral code or role mismatch");
    err.statusCode = 400;
    throw err;
  }

  // 4. Vérifier qu'on ne se parraine pas soi-même
  if (validation.referrerId === userId) {
    const err = new Error("You cannot refer yourself");
    err.statusCode = 400;
    throw err;
  }

  // 5. Vérifier que l'utilisateur n'a pas déjà d'activité
  if (currentUser.role === "customer") {
    // Vérifier pas de réservation payée
    const { count, error: bookingError } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", userId)
      .eq("payment_status", "paid");

    if (bookingError) throw bookingError;

    if (count > 0) {
      const err = new Error("Cannot apply referral code after your first paid booking");
      err.statusCode = 400;
      throw err;
    }
  } else if (currentUser.role === "provider" || currentUser.role === "provider_passionate") {
    // Vérifier pas de mission complétée
    const { count, error: bookingError } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", userId)
      .eq("status", "completed");

    if (bookingError) throw bookingError;

    if (count > 0) {
      const err = new Error("Cannot apply referral code after your first completed mission");
      err.statusCode = 400;
      throw err;
    }
  }

  // 6. Créer le referral (pending)
  const roleType = currentUser.role === "customer" ? "customer" : "detailer";
  await createPendingReferral(validation.referrerId, userId, roleType);

  // 7. Mettre à jour referred_by dans users
  const { error: updateError } = await supabase
    .from("users")
    .update({ referred_by: validation.referrerId })
    .eq("id", userId);

  if (updateError) throw updateError;

  // 8. Créditer le filleul (3€)
  const { data: u } = await supabase
    .from("users")
    .select("customer_credits_eur")
    .eq("id", userId)
    .single();

  const currentCredit = Number(u?.customer_credits_eur ?? 0) || 0;
  await supabase
    .from("users")
    .update({ customer_credits_eur: currentCredit + REFERRAL_FILLEUL_CREDIT_EUR })
    .eq("id", userId);

  console.log(`[REFERRAL] Applied code ${referralCode} for user ${userId}, credited ${REFERRAL_FILLEUL_CREDIT_EUR}€`);

  return {
    success: true,
    referrerId: validation.referrerId,
    creditAwarded: REFERRAL_FILLEUL_CREDIT_EUR,
    message: `Code de parrainage appliqué ! Vous avez reçu ${REFERRAL_FILLEUL_CREDIT_EUR}€ de crédit.`
  };
}

/**
 * Métriques plateforme parrainage (dashboard / analytics)
 * - totalReferrals, totalPending, totalValidated
 * - signupsWithReferralLast30Days : inscriptions avec referred_by non nul sur 30j
 * - conversionRate : validated / total (si total > 0)
 */
export async function getReferralPlatformStats() {
  const { count: totalReferrals, error: errTotal } = await supabase
    .from("referrals")
    .select("*", { count: "exact", head: true });
  if (errTotal) throw errTotal;

  const { count: totalPending, error: errPending } = await supabase
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  if (errPending) throw errPending;

  const { count: totalValidated, error: errValidated } = await supabase
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("status", "validated");
  if (errValidated) throw errValidated;

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: signupsWithReferralLast30Days, error: errSignups } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .not("referred_by", "is", null)
    .gte("created_at", since30d);
  if (errSignups) throw errSignups;

  const total = totalReferrals ?? 0;
  const validated = totalValidated ?? 0;
  const conversionRate = total > 0 ? Math.round((validated / total) * 100) / 100 : 0;

  return {
    totalReferrals: total,
    totalPending: totalPending ?? 0,
    totalValidated: validated,
    signupsWithReferralLast30Days: signupsWithReferralLast30Days ?? 0,
    conversionRate,
  };
}
