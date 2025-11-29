// src/controllers/authSocial.controller.js
import { socialAuthLoginApple, socialAuthLoginGoogle } from "../services/socialAuth.service.js";

export async function loginWithApple(req, res) {
  try {
    const { identityToken, authorizationCode, fullName, email } = req.body;

    if (!identityToken && !authorizationCode) {
      return res.status(400).json({ error: "Missing Apple token" });
    }

    const result = await socialAuthLoginApple({
      identityToken,
      authorizationCode,
      fullName,
      email,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("❌ loginWithApple error:", err);
    return res.status(401).json({ error: err.message || "Apple login failed" });
  }
}

export async function loginWithGoogle(req, res) {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: "Missing Google idToken" });
    }

    const result = await socialAuthLoginGoogle({ idToken });

    return res.status(200).json(result);
  } catch (err) {
    console.error("❌ loginWithGoogle error:", err);
    // ⚠️ très important : on renvoie le vrai message Supabase pour debug
    return res.status(401).json({
      error: err.message || err.error_description || "Google login failed",
    });
  }
}
