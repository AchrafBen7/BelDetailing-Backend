// src/middlewares/auth.middleware.js
import { supabase } from "../config/supabase.js";

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader =
      req.headers["authorization"] || req.headers["Authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    // 🔥 Vérifier le JWT Supabase
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      console.error("Supabase error:", error);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const user = data.user;

    // 👇 IMPORTANT : on met **sub** + id
    req.user = {
      sub: user.id,                 // pour auth.controller.getProfile
      id: user.id,                  // si tu l'utilises ailleurs
      email: user.email,
      phone: user.user_metadata?.phone || null,
      role: user.user_metadata?.role || null,
    };

    next();
  } catch (err) {
    console.error("Unexpected auth error:", err);
    return res.status(500).json({ error: "Auth middleware crashed" });
  }
};
