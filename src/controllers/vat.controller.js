import { lookupVAT, validateVATNumber } from "../services/vat.service.js";
import { supabaseAdmin } from "../config/supabase.js";

export async function lookupVATController(req, res) {
  try {
    const { vatNumber } = req.body;

    if (!vatNumber || vatNumber.trim().length === 0) {
      return res.status(400).json({ error: "Numero de TVA requis" });
    }

    const result = await lookupVAT(vatNumber);

    if (!result.valid) {
      return res.status(400).json({
        valid: false,
        error: result.error || "Numero de TVA invalide",
      });
    }

    return res.json({
      valid: true,
      companyName: result.companyName,
      address: result.address,
      city: result.city,
      postalCode: result.postalCode,
      country: result.country,
      vatNumber: result.vatNumber,
    });
  } catch (err) {
    console.error("[VAT] lookup error:", err);
    return res.status(500).json({
      error: "Erreur lors de la verification du numero de TVA",
    });
  }
}

export async function validateVATController(req, res) {
  try {
    // 🔒 SECURITY: Accepter le numéro depuis le body (POST) ou query (GET) pour rétro-compatibilité
    // Le body est préféré car les query params apparaissent dans les logs serveur
    const number = req.body?.number || req.query?.number;

    if (!number) {
      return res.status(400).json({ error: "Numero de TVA requis" });
    }

    const result = await validateVATNumber(number);

    // Quand le numéro est valide, mettre à jour l’utilisateur (is_vat_valid + vat_number)
    if (result.valid && req.user?.id) {
      await supabaseAdmin
        .from("users")
        .update({
          is_vat_valid: true,
          vat_number: number.trim().toUpperCase(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", req.user.id);
    }

    return res.json(result);
  } catch (err) {
    console.error("[VAT] validate error:", err);
    return res.status(500).json({ error: "Erreur lors de la validation" });
  }
}
