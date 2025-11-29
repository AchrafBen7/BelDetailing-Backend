// src/middlewares/auth.middleware.js
import jwt from "jsonwebtoken";

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader =
      req.headers["authorization"] || req.headers["Authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    // ---------------------------------------------------------
    // 🔥 Vérification JWT locale (compatible email + Google + Apple)
    // ---------------------------------------------------------
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET);

    // 🔥 payload.sub = UUID du user SUPABASE
    // 🔥 payload.email = email du user
    // 🔥 payload.role = metadata.role (si tu l’as mis dans signUp)
    req.user = {
      sub: payload.sub,
      email: payload.email || null,
      role: payload.role || null,
    };

    return next();

  } catch (err) {
    console.error("❌ JWT verification error:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
