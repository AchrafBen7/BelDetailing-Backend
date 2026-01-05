import { lookupVAT, validateVATNumber } from "../services/vat.service.js";

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
    const { number } = req.query;

    if (!number) {
      return res.status(400).json({ error: "Numero de TVA requis" });
    }

    const result = await validateVATNumber(number);
    return res.json(result);
  } catch (err) {
    console.error("[VAT] validate error:", err);
    return res.status(500).json({ error: "Erreur lors de la validation" });
  }
}
