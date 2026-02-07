// src/controllers/auth.controller.js
import { randomInt } from "crypto";
import { supabase, supabaseAdmin } from "../config/supabase.js";
import {
  resendVerificationEmail,
  sendVerificationEmail,
} from "../services/email.service.js";
import {
  validateReferralCodeForSignup,
  createPendingReferral,
  userAlreadyReferred,
  ensureUserReferralCode,
} from "../services/referral.service.js";

/* ============================================================
   Helper : Map row SQL → DTO User pour iOS
============================================================ */
function mapUserRowToDto(row) {
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    role: row.role,
    vatNumber: row.vat_number,
    isVatValid: row.is_vat_valid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    customerProfile: row.customer_profiles?.length
      ? {
          firstName: row.customer_profiles[0].first_name,
          lastName: row.customer_profiles[0].last_name,
          defaultAddress: row.customer_profiles[0].default_address,
          preferredCityId: row.customer_profiles[0].preferred_city_id,
        }
      : null,

    companyProfile: row.company_profiles?.length
      ? {
          legalName: row.company_profiles[0].legal_name,
          companyTypeId: row.company_profiles[0].company_type_id,
          city: row.company_profiles[0].city,
          postalCode: row.company_profiles[0].postal_code,
          contactName: row.company_profiles[0].contact_name,
          logoUrl: row.company_profiles[0].logo_url,
        }
      : null,

    providerProfile: row.provider_profiles?.length
      ? {
          displayName: row.provider_profiles[0].display_name,
          bio: row.provider_profiles[0].bio,
          baseCity: row.provider_profiles[0].base_city,
          postalCode: row.provider_profiles[0].postal_code,
          hasMobileService: row.provider_profiles[0].has_mobile_service,
          minPrice: row.provider_profiles[0].min_price,
          rating: row.provider_profiles[0].rating,
          services: row.provider_profiles[0].services,
        }
      : null,
  };
}

// 🔒 SECURITY: Utiliser crypto.randomInt au lieu de Math.random()
function generateVerificationCode() {
  return randomInt(100000, 1000000).toString();
}

/* ============================================================
   REGISTER
============================================================ */
// ========= REGISTER =========
export async function register(req, res) {
  const { email, password, role, phone, vat_number } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Missing email or password" });
  }

  const finalRole = (role || "customer").toLowerCase();

  // 🔒 Admin : secret requis + uniquement le premier compte (bootstrap)
  if (finalRole === "admin") {
    const adminSecret = process.env.ADMIN_REGISTRATION_SECRET;
    const providedSecret = req.body.admin_secret;

    if (!adminSecret) {
      return res.status(503).json({
        error: "Admin registration is not configured (ADMIN_REGISTRATION_SECRET missing).",
      });
    }
    if (providedSecret !== adminSecret) {
      return res.status(403).json({
        error: "Invalid or missing admin_secret. Admin registration requires the correct secret.",
      });
    }

    const { count, error: countError } = await supabaseAdmin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (countError) {
      return res.status(500).json({ error: "Unable to verify admin count" });
    }
    if (count > 0) {
      return res.status(403).json({
        error: "Admin registration is disabled. An admin account already exists.",
      });
    }
  }

  // 🌟 RÈGLE : VAT obligatoire pour provider/company (mais PAS pour provider_passionate)
  // ✅ provider_passionate n'a PAS besoin de TVA
  if (finalRole === "provider_passionate") {
    // Pas de vérification TVA pour les passionnés
  } else if ((finalRole === "provider" || finalRole === "company") && !vat_number) {
    return res.status(400).json({
      error: "VAT number is required for providers and companies."
    });
  }

  // 1) Création Supabase Auth user
  const { data: signUpData, error: signUpError } =
    await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: finalRole,
          phone: phone || "",
          vat_number: vat_number || null,
        },
      },
    });

  if (signUpError) {
    return res.status(400).json({ error: signUpError.message });
  }

  const authUser = signUpData.user;
  if (!authUser) {
    return res.status(500).json({ error: "No user returned from Supabase" });
  }

  // 2) Ligne dans public.users
  const { error: insertError } = await supabaseAdmin.from("users").insert({
    id: authUser.id,
    email: authUser.email,
    phone: phone || "",
    role: finalRole,
    vat_number: (finalRole !== "customer" && finalRole !== "provider_passionate") ? vat_number : null,
    is_vat_valid: (finalRole !== "customer" && finalRole !== "provider_passionate") ? false : null,
    welcoming_offer_used: false, // ✅ Explicitement FALSE pour tous les nouveaux comptes
    dismissed_first_booking_offer: false, // ✅ Explicitement FALSE pour tous les nouveaux comptes
  });

  if (insertError) {
    return res.status(500).json({ error: insertError.message });
  }

  // 2b) Parrainage: code unique + referred_by + crédit filleul (double-sided)
  try {
    await ensureUserReferralCode(authUser.id);
    const refCode = req.body.ref || req.body.referral_code;
    if (refCode) {
      const valid = await validateReferralCodeForSignup(refCode, finalRole);
      if (valid && valid.referrerId !== authUser.id) {
        const alreadyReferred = await userAlreadyReferred(authUser.id);
        if (!alreadyReferred) {
          const userUpdate = { referred_by: valid.referrerId };
          if (finalRole === "customer") {
            userUpdate.customer_credits_eur = 3; // Filleul reçoit toujours le niveau 1 (3€ crédit)
          }
          await supabaseAdmin.from("users").update(userUpdate).eq("id", authUser.id);
          await createPendingReferral(valid.referrerId, authUser.id, finalRole);
        }
      }
    }
  } catch (refErr) {
    console.warn("[AUTH] Referral setup failed (non-blocking):", refErr.message);
  }

  // ============================================================
  // 3) Création des PROFILES
  // ============================================================

  // CUSTOMER
  if (finalRole === "customer") {
    const { error: custError } = await supabaseAdmin
      .from("customer_profiles")
      .insert({
        user_id: authUser.id,
        first_name: "",
        last_name: "",
        default_address: "",
        preferred_city_id: null,
      });

    if (custError) {
      return res.status(500).json({ error: custError.message });
    }
  }

  // COMPANY
  if (finalRole === "company") {
    const { error: companyError } = await supabaseAdmin
      .from("company_profiles")
      .insert({
        user_id: authUser.id,
        legal_name: authUser.email.split("@")[0],
        company_type_id: "default",
        city: "",
        postal_code: "",
        contact_name: "",
        logo_url: null,
      });

    if (companyError) {
      return res.status(500).json({ error: companyError.message });
    }
  }

  // PROVIDER (profile) – utilise provider_profile du body si fourni (display_name, opening_hours, etc.)
  if (finalRole === "provider") {
    const pp = req.body.provider_profile || {};
    const base = {
      user_id: authUser.id,
      display_name: pp.display_name ?? authUser.email.split("@")[0],
      bio: pp.bio ?? "",
      base_city: pp.base_city ?? "",
      postal_code: pp.postal_code ?? "",
      lat: 0,
      lng: 0,
      has_mobile_service: pp.has_mobile_service ?? false,
      min_price: Number(pp.min_price) || 0,
      rating: 0,
      review_count: 0,
      services: Array.isArray(pp.services) ? pp.services : [],
      team_size: 1,
      years_of_experience: 0,
      logo_url: null,
      banner_url: null,
    };
    if (pp.company_name != null) base.company_name = pp.company_name;
    if (pp.opening_hours != null && pp.opening_hours !== "") base.opening_hours = pp.opening_hours;

    const { error: provProfileErr } = await supabaseAdmin
      .from("provider_profiles")
      .insert(base);

    if (provProfileErr) {
      return res.status(500).json({ error: provProfileErr.message });
    }
  }

  // PROVIDER_PASSIONATE (profile) – idem avec plafond annuel
  if (finalRole === "provider_passionate") {
    const pp = req.body.provider_profile || {};
    const base = {
      user_id: authUser.id,
      display_name: pp.display_name ?? authUser.email.split("@")[0],
      bio: pp.bio ?? "",
      base_city: pp.base_city ?? "",
      postal_code: pp.postal_code ?? "",
      lat: 0,
      lng: 0,
      has_mobile_service: pp.has_mobile_service ?? false,
      min_price: Number(pp.min_price) || 0,
      rating: 0,
      review_count: 0,
      services: Array.isArray(pp.services) ? pp.services : [],
      team_size: 1,
      years_of_experience: 0,
      logo_url: null,
      banner_url: null,
      annual_revenue_limit: 2000.00,
      annual_revenue_current: 0.00,
      annual_revenue_year: new Date().getFullYear(),
    };
    if (pp.company_name != null) base.company_name = pp.company_name;
    if (pp.opening_hours != null && pp.opening_hours !== "") base.opening_hours = pp.opening_hours;

    const { error: provProfileErr } = await supabaseAdmin
      .from("provider_profiles")
      .insert(base);

    if (provProfileErr) {
      return res.status(500).json({ error: provProfileErr.message });
    }
  }

  // ============================================================
  // 5) ENVOI FINAL
  // ============================================================
  const verificationCode = generateVerificationCode();
  const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const { error: tokenError } = await supabaseAdmin
    .from("users")
    .update({
      email_verification_code: verificationCode,
      email_verification_code_expires_at: codeExpiresAt.toISOString(),
      email_verified: false,
    })
    .eq("id", authUser.id);

  if (tokenError) {
    console.error("[AUTH] code save error:", tokenError);
  }

  try {
    await sendVerificationEmail(authUser.email, verificationCode);
  } catch (emailError) {
    console.error("[AUTH] verification email error:", emailError);
  }

  return res.status(201).json({
    success: true,
    email: authUser.email,
    role: finalRole,
    emailSent: true,
  });

}


/* ============================================================
   LOGIN
============================================================ */
export async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Missing email or password" });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return res.status(401).json({ error: error.message });
  }

  const { session, user } = data;

  // ⚠️ IMPORTANT : Utiliser supabaseAdmin pour éviter les problèmes de RLS
  // Lecture public.users avec SERVICE_ROLE (bypass RLS)
  let { data: userRow, error: userError } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (userError) return res.status(500).json({ error: userError.message });

  // Si absent → recreate automatiquement avec SERVICE_ROLE (bypass RLS)
  if (!userRow) {
    const { data: upserted, error: upsertError } = await supabaseAdmin
      .from("users")
      .upsert(
        {
          id: user.id,
          email: user.email,
          phone: user.user_metadata?.phone || "",
          role: user.user_metadata?.role || "customer",
        },
        { onConflict: "id" }
      )
      .select("*")
      .single();

    if (upsertError) {
      return res.status(500).json({ error: upsertError.message });
    }

    userRow = upserted;
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      role: userRow.role,
      phone: userRow.phone,
      vatNumber: userRow.vat_number,
      isVatValid: userRow.is_vat_valid,
    },
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    tokenType: session.token_type,
    expiresIn: session.expires_in,
  });
}

/* ============================================================
   REFRESH TOKEN
============================================================ */
export async function refreshToken(req, res) {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: "Missing refreshToken" });
  }

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error) {
    return res.status(401).json({ error: error.message });
  }

  const { session, user } = data;

  // ⚠️ IMPORTANT : Utiliser supabaseAdmin pour éviter les problèmes de RLS
  const { data: userRow, error: userError } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (userError) {
    return res.status(500).json({ error: userError.message });
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      role: userRow.role,
      phone: userRow.phone,
      vatNumber: userRow.vat_number,
      isVatValid: userRow.is_vat_valid,
    },
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    tokenType: session.token_type,
    expiresIn: session.expires_in,
  });
}


/* ============================================================
   CHANGE PASSWORD (requireAuth)
============================================================ */
export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Missing currentPassword or newPassword" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }

    // Vérifier le mot de passe actuel
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: req.user.email,
      password: currentPassword,
    });
    if (signInError) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // Mettre à jour le mot de passe via Admin
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      req.user.id,
      { password: newPassword }
    );
    if (updateError) {
      console.error("[AUTH] changePassword update error:", updateError);
      return res.status(500).json({ error: "Could not update password" });
    }

    return res.json({ success: true, message: "Password updated" });
  } catch (err) {
    console.error("[AUTH] changePassword error:", err);
    return res.status(500).json({ error: "Could not change password" });
  }
}

/* ============================================================
   logout
============================================================ */
export async function logout(req, res) {
  try {
    // Récupère le Bearer token du header
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(400).json({ error: "Missing access token" });
    }

    // Supprime la session côté Supabase
    const { error } = await supabase.auth.admin.signOut(token);

    if (error) {
      console.error("Supabase logout error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ error: "Logout failed" });
  }
}

/* ============================================================
   VERIFY EMAIL
============================================================ */
export async function verifyEmail(req, res) {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Missing email or code" });
    }

    if (!/^\d{6}$/.test(code)) {
      return res
        .status(400)
        .json({ error: "Invalid code format. Code must be 6 digits." });
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select(
        "id, email, email_verified, email_verification_code, email_verification_code_expires_at"
      )
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (userError) {
      console.error("❌ [AUTH] verifyEmail error:", userError);
      return res.status(500).json({ error: "Database error" });
    }

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.email_verified) {
      return res.status(400).json({ error: "Email already verified" });
    }

    // 🔒 SECURITY: Vérifier expiration AVANT de tester le code
    if (user.email_verification_code_expires_at) {
      const expiresAt = new Date(user.email_verification_code_expires_at);
      if (expiresAt < new Date()) {
        return res.status(400).json({
          error: "Verification code has expired. Please request a new one.",
        });
      }
    }

    if (user.email_verification_code !== code) {
      // 🔒 SECURITY: Incrémenter le compteur de tentatives
      const attempts = (user.email_verification_attempts || 0) + 1;
      const updatePayload = { email_verification_attempts: attempts };

      // Après 5 tentatives échouées, invalider le code
      if (attempts >= 5) {
        updatePayload.email_verification_code = null;
        updatePayload.email_verification_code_expires_at = null;
        updatePayload.email_verification_attempts = 0;

        await supabaseAdmin
          .from("users")
          .update(updatePayload)
          .eq("id", user.id);

        return res.status(400).json({
          error: "Too many failed attempts. Please request a new verification code.",
        });
      }

      await supabaseAdmin
        .from("users")
        .update(updatePayload)
        .eq("id", user.id);

      return res.status(400).json({ error: "Invalid verification code" });
    }

    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        email_verified: true,
        email_verification_code: null,
        email_verification_code_expires_at: null,
        email_verification_attempts: 0,
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("❌ [AUTH] verifyEmail update error:", updateError);
      return res.status(500).json({ error: "Could not verify email" });
    }

    console.log("✅ [AUTH] Email verified for:", user.email);

    return res.json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (err) {
    console.error("❌ [AUTH] verifyEmail exception:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/* ============================================================
   RESEND VERIFICATION EMAIL
============================================================ */
export async function resendVerificationEmailController(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id, email, email_verified")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (userError) {
      console.error("❌ [AUTH] resendVerificationEmail error:", userError);
      return res.status(500).json({ error: "Database error" });
    }

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.email_verified) {
      return res.status(400).json({ error: "Email already verified" });
    }

    const verificationCode = generateVerificationCode();
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        email_verification_code: verificationCode,
        email_verification_code_expires_at: codeExpiresAt.toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      console.error(
        "❌ [AUTH] resendVerificationEmail code update error:",
        updateError
      );
      return res.status(500).json({ error: "Could not update code" });
    }

    try {
      await sendVerificationEmail(user.email, verificationCode);
      console.log("✅ [AUTH] Resend verification code sent to:", user.email);
      return res.json({ success: true, message: "Verification code sent" });
    } catch (emailError) {
      console.error("❌ [AUTH] Resend email error:", emailError);
      return res.status(500).json({ error: "Could not send email" });
    }
  } catch (err) {
    console.error("❌ [AUTH] resendVerificationEmail exception:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
