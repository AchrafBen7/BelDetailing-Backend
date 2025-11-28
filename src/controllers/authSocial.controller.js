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

    // result = { user, accessToken }
    return res.status(200).json(result);
  } catch (err) {
    console.error("❌ loginWithApple error:", err);
    return res.status(401).json({ error: "Apple login failed" });
  }
}

export async function loginWithGoogle(req, res) {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: "Missing Google idToken" });
    }

    const result = await socialAuthLoginGoogle({ idToken });

    // result = { user, accessToken }
    return res.status(200).json(result);
  } catch (err) {
    console.error("❌ loginWithGoogle error:", err);
    return res.status(401).json({ error: "Google login failed" });
  }
}
