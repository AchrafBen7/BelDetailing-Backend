import { supabase } from "../config/supabase.js";

export const register = async (req, res) => {
  try {
    const { email, password, role, phone } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ error: "email, password, role are required" });
    }

    // 1️⃣ Création user dans Supabase Auth
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role,
          phone,
        },
      },
    });

    if (signUpError) {
      console.error("Supabase signUp error:", signUpError);
      return res.status(400).json({ error: signUpError.message });
    }

    const authUser = signUpData.user;

    // 2️⃣ Insert dans ta table public.users (id = auth.user.id)
    const { error: dbError } = await supabase.from("users").insert({
      id: authUser.id,
      email,
      phone,
      role,
    });

    if (dbError) {
      console.error("DB insert users error:", dbError);
      // on ne bloque pas totalement l’API, mais on log
    }

    // 3️⃣ Retour minimal pour ton app iOS
    return res.status(201).json({
      user: {
        id: authUser.id,
        email: authUser.email,
        role,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("Supabase login error:", error);
      return res.status(401).json({ error: error.message });
    }

    const { session, user } = data;

    // On renvoie les tokens pour iOS
    return res.json({
      user: {
        id: user.id,
        email: user.email,
      },
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      tokenType: session.token_type,
      expiresIn: session.expires_in,
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// (optionnel pour plus tard) refresh token
export const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "refreshToken is required" });
    }

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error) {
      console.error("Supabase refresh error:", error);
      return res.status(401).json({ error: error.message });
    }

    const { session, user } = data;

    return res.json({
      user: {
        id: user.id,
        email: user.email,
      },
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      tokenType: session.token_type,
      expiresIn: session.expires_in,
    });
  } catch (err) {
    console.error("Refresh error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
