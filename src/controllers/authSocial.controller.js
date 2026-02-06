// src/controllers/authSocial.controller.js
import { socialAuthLoginApple, socialAuthLoginGoogle } from "../services/socialAuth.service.js";

export async function loginWithApple(req, res) {
  try {
    const { identityToken, authorizationCode, fullName, email } = req.body;

    // 🔒 SECURITY: Validation basique des inputs
    if (!identityToken && !authorizationCode) {
      return res.status(400).json({ error: "Missing Apple token" });
    }

    if (identityToken && typeof identityToken !== "string") {
      return res.status(400).json({ error: "identityToken must be a string" });
    }

    if (authorizationCode && typeof authorizationCode !== "string") {
      return res.status(400).json({ error: "authorizationCode must be a string" });
    }

    // Limiter la taille des tokens pour éviter l'abus
    if (identityToken && identityToken.length > 10000) {
      return res.status(400).json({ error: "identityToken too long" });
    }

    if (email && (typeof email !== "string" || email.length > 255)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    if (fullName && typeof fullName !== "string") {
      // fullName peut être un string ou absent
    }

    const result = await socialAuthLoginApple({
      identityToken,
      authorizationCode,
      fullName: typeof fullName === "string" ? fullName.substring(0, 200) : fullName,
      email,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("❌ loginWithApple error:", err.message);
    return res.status(401).json({
      error: process.env.NODE_ENV === "development" ? err.message : "Apple login failed",
    });
  }
}

export async function loginWithGoogle(req, res) {
  try {
    const { idToken } = req.body;

    // 🔒 SECURITY: Validation basique des inputs
    if (!idToken) {
      return res.status(400).json({ error: "Missing Google idToken" });
    }

    if (typeof idToken !== "string") {
      return res.status(400).json({ error: "idToken must be a string" });
    }

    if (idToken.length > 10000) {
      return res.status(400).json({ error: "idToken too long" });
    }

    const result = await socialAuthLoginGoogle({ idToken });

    return res.status(200).json(result);
  } catch (err) {
    console.error("❌ loginWithGoogle error:", err.message);
    // 🔒 SECURITY: Ne pas exposer les messages d'erreur internes en production
    return res.status(401).json({
      error: process.env.NODE_ENV === "development"
        ? (err.message || err.error_description || "Google login failed")
        : "Google login failed",
    });
  }
}
