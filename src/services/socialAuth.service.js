// src/services/socialAuth.service.js
import { supabase, supabaseAdmin } from "../config/supabase.js";
import { verifyAppleToken } from "./thirdPartyVerification.service.js";

async function upsertCustomUser({
  provider,
  providerUserId,
  email,
  fullName,
}) {
  let { data: user } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq(`${provider}_id`, providerUserId)
    .maybeSingle();

  if (!user && email) {
    const { data } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    user = data;
  }

  if (!user) {
    const [firstName, ...rest] = (fullName ?? "").split(" ");
    const lastName = rest.join(" ") || null;

    const { data: created, error: createError } = await supabaseAdmin
      .from("users")
      .insert({
        email: email?.toLowerCase() ?? null,
        first_name: firstName || null,
        last_name: lastName || null,
        role: "customer",
        [`${provider}_id`]: providerUserId,
      })
      .select("*")
      .single();

    if (createError) throw createError;
    user = created;
  }

  return user;
}

// 🔹 APPLE LOGIN (on laisse comme tu as)
export async function socialAuthLoginApple({ identityToken, fullName, email }) {
  const apple = await verifyAppleToken({ identityToken });

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: identityToken,
  });

  if (error) {
    console.error("❌ Supabase Apple signInWithIdToken error:", error);
    throw new Error(error.message || "Supabase Apple login failed");
  }

  const customUser = await upsertCustomUser({
    provider: "apple",
    providerUserId: apple.userId,
    email: email ?? apple.emailFromToken,
    fullName,
  });

  return {
    user: customUser,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    userRole: customUser.role,
  };
}

// 🔹 GOOGLE LOGIN
export async function socialAuthLoginGoogle({ idToken }) {
  // 1. Connexion Supabase Auth
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });

  if (error) {
    console.error("❌ Supabase Google signInWithIdToken error:", error);
    // on remonte un vrai message exploitable
    throw new Error(error.message || error.error_description || "Supabase Google login failed");
  }

  const authUser = data.user;

  // 2. Remplir ta table custom
  const customUser = await upsertCustomUser({
    provider: "google",
    providerUserId: authUser.id,
    email: authUser.email,
    fullName: authUser.user_metadata?.full_name ?? "",
  });

  return {
    user: customUser,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    userRole: customUser.role,
  };
}
