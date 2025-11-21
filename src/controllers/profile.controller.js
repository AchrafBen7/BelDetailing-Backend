// src/controllers/profile.controller.js

// Plus tard, on ira lire dans la table "users" + profiles.
// Pour l'instant, on renvoie déjà les infos du token Supabase.

export const getProfile = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Basé sur ton modèle iOS : User
    const user = {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role || "customer",
      phone: req.user.phone || null,
      // Ces champs viendront plus tard des tables Supabase :
      vatNumber: null,
      isVatValid: null,
      createdAt: null,
      updatedAt: null,
      customerProfile: null,
      companyProfile: null,
      providerProfile: null,
    };

    return res.json({ user });
  } catch (err) {
    console.error("[PROFILE] getProfile error:", err);
    return res.status(500).json({ error: "Could not fetch profile" });
  }
};
