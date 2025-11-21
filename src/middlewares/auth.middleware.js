import { supabase } from "../config/supabase.js";

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader =
      req.headers["authorization"] || req.headers["Authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    // 🔥 La SEULE façon valide de vérifier un JWT Supabase
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      console.error("Supabase error:", error);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // 🔥 On injecte l'user dans req.user
    req.user = {
      id: data.user.id,
      email: data.user.email,
      phone: data.user.user_metadata?.phone || null,
      role: data.user.user_metadata?.role || null,
    };

    next();
  } catch (err) {
    console.error("Unexpected auth error:", err);
    return res.status(500).json({ error: "Auth middleware crashed" });
  }
};
