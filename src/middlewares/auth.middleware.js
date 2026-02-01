import { supabase } from "../config/supabase.js";
import { supabaseAdmin } from "../config/supabase.js";

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader =
      req.headers["authorization"] || req.headers["Authorization"];

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    // Vérification JWT Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.log("❌ Invalid Supabase token:", error?.message);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Rôle depuis la base (source de vérité), pas seulement le JWT
    let role = user.user_metadata?.role ?? null;
    const { data: userRow, error: userError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!userError && userRow?.role) {
      role = userRow.role;
    }

    req.user = {
      id: user.id,
      email: user.email,
      role,
    };

    return next();

  } catch (err) {
    console.error("❌ Auth middleware exception:", err);
    return res.status(401).json({ error: "Unauthorized" });
  }
};
