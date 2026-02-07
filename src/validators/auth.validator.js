// src/validators/auth.validator.js
import { body } from "express-validator";

const ROLE_VALUES = ["customer", "provider", "company", "provider_passionate", "admin"];

export const registerValidation = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email format")
    .isLength({ max: 255 })
    .withMessage("Email too long"),
  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .isLength({ max: 128 })
    .withMessage("Password too long"),
  body("role")
    .optional()
    .trim()
    .isIn(ROLE_VALUES)
    .withMessage("Invalid role"),
  body("phone")
    .optional()
    .trim()
    .isLength({ max: 32 })
    .withMessage("Phone too long"),
  body("vat_number")
    .optional()
    .trim()
    .isLength({ max: 64 })
    .withMessage("VAT number too long"),
];

export const loginValidation = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email format"),
  body("password").notEmpty().withMessage("Password is required"),
];

export const refreshTokenValidation = [
  body("refreshToken").notEmpty().withMessage("refreshToken is required"),
];
