// src/services/auth.service.js
import { supabase } from "../config/supabase.js";

export async function registerUser({ email, password, role, phone }) {
  // 1) Créer l'utilisateur dans Supabase Auth
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        role,
        phone,
      },
    },
  });

  if (error) {
    throw error;
  }

  const authUser = data.user;

  // 2) Créer la ligne dans la table public.users
  const { error: insertError } = await supabase.from("users").insert({
    id: authUser.id, // 👈 même id que auth.users
    email,
    phone,
    role,
  });

  if (insertError) {
    throw insertError;
  }

  // On renvoie juste le minimum pour l’app iOS
  return {
    id: authUser.id,
    email,
    role,
  };
}

export async function loginUser({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  const { session, user } = data;

  return {
    user: {
      id: user.id,
      email: user.email,
    },
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  };
}

export async function refreshSession({ refreshToken }) {
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error) {
    throw error;
  }

  const { session, user } = data;

  return {
    user: {
      id: user.id,
      email: user.email,
    },
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  };
}
