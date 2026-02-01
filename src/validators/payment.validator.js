// src/validators/payment.validator.js
import { body } from "express-validator";

const CURRENCIES = ["eur", "usd", "gbp"];

export const createPaymentIntentValidation = [
  body("amount")
    .notEmpty()
    .withMessage("amount is required")
    .isFloat({ min: 0.01, max: 999_999.99 })
    .withMessage("amount must be a positive number"),
  body("currency")
    .notEmpty()
    .withMessage("currency is required")
    .isIn(CURRENCIES)
    .withMessage("currency must be eur, usd or gbp"),
];

export const capturePaymentValidation = [
  body("paymentIntentId").notEmpty().withMessage("paymentIntentId is required").trim(),
];

export const refundPaymentValidation = [
  body("paymentIntentId").notEmpty().withMessage("paymentIntentId is required").trim(),
];
