// src/validators/index.js
import { validationResult } from "express-validator";

/**
 * Middleware qui exécute les validations et renvoie 400 avec le premier message d'erreur.
 * À placer après les validateXXX() dans les routes.
 */
export function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const first = errors.array({ onlyFirstError: true })[0];
    const message = first?.msg ?? "Validation failed";
    return res.status(400).json({ error: message });
  }
  next();
}
