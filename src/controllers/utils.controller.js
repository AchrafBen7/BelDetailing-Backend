// src/controllers/utils.controller.js
import { validateVATNumber } from "../services/vat.service.js";

export async function validateVAT(req, res) {
  try {
    const { number } = req.query;

    if (!number) {
      return res.status(400).json({ error: "Missing VAT number" });
    }

    const result = await validateVATNumber(number);
    return res.json(result);
  } catch (err) {
    console.error("[VAT] validate error:", err);
    return res.status(500).json({ error: "Could not validate VAT number" });
  }
}
