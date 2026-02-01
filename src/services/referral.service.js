// src/services/referral.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

const REFERRAL_CODE_LENGTH = 8;
const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O, 1/I pour lisibilité

/** Nombre de missions complétées par le detailer filleul pour valider le parrainage (Phase 1) */
const REFERRAL_PROVIDER_MISSIONS_REQUIRED = 3;

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

/**
 * Crée l'entrée referral (pending) après inscription
 */
export async function createPendingReferral(referrerId, referredId, roleType) {
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

  // Paliers 1 à 10 (amis invités validés) – effet gamification
  const tierMilestones = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const tiers = tierMilestones.map((invitesRequired) => ({
    level: invitesRequired,
    invitesRequired,
    rewardDescription: invitesRequired === 1 ? "10€ crédit" : `${invitesRequired * 10}€ crédit`,
    reached: validated >= invitesRequired,
  }));
  const nextTierAt = tierMilestones.find((t) => t > validated) ?? null; // prochain palier à atteindre

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
 * Marque un referral comme validé et enregistre la récompense (Customer: 1ère résa payée)
 */
export async function validateReferralCustomer(referredUserId) {
  const { data: ref, error: fetchError } = await supabase
    .from("referrals")
    .select("id, referrer_id")
    .eq("referred_id", referredUserId)
    .eq("status", "pending")
    .maybeSingle();
  if (fetchError || !ref) return;

  const rewardType = "credit";
  const rewardValue = 10; // 10 € crédit (palier 1 MVP)
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
  // Crédit parrainage (réduction sur prochaine résa, pas de cash direct)
  const { data: u } = await supabase.from("users").select("customer_credits_eur").eq("id", ref.referrer_id).single();
  const current = Number(u?.customer_credits_eur ?? 0) || 0;
  await supabase.from("users").update({ customer_credits_eur: current + rewardValue }).eq("id", ref.referrer_id);
  console.log(`[REFERRAL] Validated customer referral ${ref.id}, referrer ${ref.referrer_id} gets ${rewardValue}€ credit`);
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
