// src/validators/profile.validator.js
import { body } from "express-validator";

/**
 * PATCH /profile – validation des champs autorisés (longueurs, types).
 * Le controller rejette déjà "role" sauf transition provider_passionate → provider.
 */
export const updateProfileValidation = [
  body("phone").optional().trim().isLength({ max: 32 }).withMessage("phone too long"),
  body("vatNumber").optional().trim().isLength({ max: 64 }).withMessage("vat number too long"),
  body("isVatValid").optional().isBoolean(),
  body("dismissedFirstBookingOffer").optional().isBoolean(),
  body("role").optional().trim().isIn(["provider_passionate", "provider"]).withMessage("Invalid role for update"),
  // Nested profiles – max lengths only; structure is checked in controller
  body("customerProfile").optional().isObject(),
  body("customerProfile.firstName").optional().trim().isLength({ max: 100 }),
  body("customerProfile.lastName").optional().trim().isLength({ max: 100 }),
  body("customerProfile.defaultAddress").optional().trim().isLength({ max: 500 }),
  body("customerProfile.preferredCityId").optional().trim().isLength({ max: 64 }),
  body("customerProfile.avatarUrl").optional().trim().isLength({ max: 2048 }),
  body("companyProfile").optional().isObject(),
  body("companyProfile.legalName").optional().trim().isLength({ max: 200 }),
  body("companyProfile.city").optional().trim().isLength({ max: 100 }),
  body("companyProfile.postalCode").optional().trim().isLength({ max: 20 }),
  body("companyProfile.contactName").optional().trim().isLength({ max: 200 }),
  body("companyProfile.logoUrl").optional().trim().isLength({ max: 2048 }),
  body("providerProfile").optional().isObject(),
  body("providerProfile.displayName").optional().trim().isLength({ max: 100 }),
  body("providerProfile.bio").optional().trim().isLength({ max: 2000 }),
  body("providerProfile.baseCity").optional().trim().isLength({ max: 100 }),
  body("providerProfile.postalCode").optional().trim().isLength({ max: 20 }),
  body("providerProfile.minPrice").optional().isFloat({ min: 0 }),
  body("providerProfile.logoUrl").optional().trim().isLength({ max: 2048 }),
  body("providerProfile.bannerUrl").optional().trim().isLength({ max: 2048 }),
];
