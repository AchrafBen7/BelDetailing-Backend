import { supabase } from "../config/supabase.js";

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader =
      req.headers["authorization"] || req.headers["Authorization"];

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    // 🔥 Vérification OFFICIELLE Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.log("❌ Invalid Supabase token:", error?.message);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // 🔥 User OK
    req.user = {
      id: user.id,
      email: user.email,
      role: user.user_metadata?.role ?? null,
    };

    return next();

  } catch (err) {
    console.error("❌ Auth middleware exception:", err);
    return res.status(401).json({ error: "Unauthorized" });
  }
};
