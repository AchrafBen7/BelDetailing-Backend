// src/validators/offer.validator.js
import { body } from "express-validator";

const OFFER_TYPES = ["oneTime", "recurring", "longTerm"];
const CATEGORIES = ["carCleaning", "fleet", "other"];

export const createOfferValidation = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("title is required")
    .isLength({ max: 200 })
    .withMessage("title too long"),
  body("category")
    .optional()
    .trim()
    .isIn(CATEGORIES)
    .withMessage("Invalid category"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage("description too long"),
  body("vehicleCount").optional().isInt({ min: 1, max: 999 }),
  body("priceMin").optional().isFloat({ min: 0, max: 999999 }),
  body("priceMax").optional().isFloat({ min: 0, max: 999999 })
    .custom((value, { req }) => {
      // 🔒 SECURITY: Vérifier que priceMax >= priceMin
      if (req.body.priceMin != null && value != null) {
        if (Number(value) < Number(req.body.priceMin)) {
          throw new Error("priceMax must be greater than or equal to priceMin");
        }
      }
      return true;
    }),
  body("city").optional().trim().isLength({ max: 100 }),
  body("postalCode").optional().trim().isLength({ max: 20 }),
  body("lat").optional().isFloat({ min: -90, max: 90 }),
  body("lng").optional().isFloat({ min: -180, max: 180 }),
  body("type")
    .optional()
    .trim()
    .isIn(OFFER_TYPES)
    .withMessage("Invalid type"),
  body("vehicleTypes").optional().isArray(),
  body("prerequisites").optional().isArray(),
  body("isUrgent").optional().isBoolean(),
  body("interventionMode").optional().trim().isIn(["onSite", "mobile", "hybrid"]).withMessage("Invalid interventionMode"),
];
