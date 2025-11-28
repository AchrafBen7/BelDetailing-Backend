// src/services/socialAuth.service.js
import { supabase } from "../config/supabase.js";
import { verifyAppleToken } from "./thirdPartyVerification.service.js";

// 🧠 UTILITAIRE : upsert dans TA TABLE "users"
async function upsertCustomUser({
  provider,
  providerUserId,
  email,
  fullName,
}) {
  // 1. Chercher par provider_id
  let { data: user } = await supabase
    .from("users")
    .select("*")
    .eq(`${provider}_id`, providerUserId)
    .maybeSingle();

  // 2. Sinon chercher par email
  if (!user && email) {
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    user = data;
  }

  // 3. Si pas trouvé → création SQL dans TA table
  if (!user) {
    const [firstName, ...rest] = (fullName ?? "").split(" ");
    const lastName = rest.join(" ") || null;

    const { data: created, error: createError } = await supabase
      .from("users")
      .insert({
        email: email?.toLowerCase() ?? null,
        first_name: firstName || null,
        last_name: lastName || null,
        role: "customer",         // 🔥 tu gardes ton rôle
        [`${provider}_id`]: providerUserId,
      })
      .select("*")
      .single();

    if (createError) throw createError;
    user = created;
  }

  return user;
}

// 🔹 APPLE LOGIN
export async function socialAuthLoginApple({ identityToken, fullName, email }) {
  // 1. vérifier le token Apple
  const apple = await verifyAppleToken({ identityToken });

  // 2. connexion Supabase Auth
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: identityToken,
  });

  if (error) throw error;

  // 3. upsert dans TA table "users"
  const customUser = await upsertCustomUser({
    provider: "apple",
    providerUserId: apple.userId,
    email: email ?? apple.emailFromToken,
    fullName,
  });

  // 4. retourner les infos
  return {
    user: customUser,
    accessToken: data.session.access_token,  // 🔥 token Supabase
  };
}

// 🔹 GOOGLE LOGIN
export async function socialAuthLoginGoogle({ idToken }) {
  // 1. Connexion Supabase Auth
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });

  if (error) throw error;

  const authUser = data.user; // user Supabase Auth

  // 2. Remplir ta table custom
  const customUser = await upsertCustomUser({
    provider: "google",
    providerUserId: authUser.id,   // 🔥 Google renvoie sub->Supabase user.id
    email: authUser.email,
    fullName: authUser.user_metadata.full_name ?? "",
  });

  return {
    user: customUser,
    accessToken: data.session.access_token,
  };
}
