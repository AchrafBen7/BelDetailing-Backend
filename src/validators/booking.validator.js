// src/validators/booking.validator.js
import { body } from "express-validator";

export const createBookingValidation = [
  body("provider_id").notEmpty().withMessage("provider_id is required").trim(),
  body("service_id").optional().trim(),
  body("service_ids").optional().isArray().withMessage("service_ids must be an array"),
  body()
    .custom((value, { req }) => {
      const hasServiceId = req.body?.service_id && String(req.body.service_id).trim();
      const hasServiceIds = Array.isArray(req.body?.service_ids) && req.body.service_ids.length > 0;
      if (!hasServiceId && !hasServiceIds) {
        throw new Error("service_id or service_ids (non-empty) is required");
      }
      return true;
    }),
  body("date")
    .notEmpty()
    .withMessage("date is required")
    .trim()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage("date must be YYYY-MM-DD"),
  body("start_time")
    .notEmpty()
    .withMessage("start_time is required")
    .trim()
    .isLength({ max: 8 })
    .withMessage("start_time too long"),
  body("end_time")
    .notEmpty()
    .withMessage("end_time is required")
    .trim()
    .isLength({ max: 8 })
    .withMessage("end_time too long"),
  body("address")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("address too long"),
  body("customer_address_lat").optional().isFloat({ min: -90, max: 90 }),
  body("customer_address_lng").optional().isFloat({ min: -180, max: 180 }),
];

// PATCH /bookings/:id – seuls les champs autorisés, avec types/longueurs
const BOOKING_PATCH_WHITELIST = [
  "address",
  "date",
  "start_time",
  "end_time",
  "customer_address_lat",
  "customer_address_lng",
  "transport_fee",
  "transport_distance_km",
];

export const patchBookingValidation = [
  body()
    .custom((value, { req }) => {
      const payload = req.body;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
      const keys = Object.keys(payload);
      const invalid = keys.filter((k) => !BOOKING_PATCH_WHITELIST.includes(k));
      if (invalid.length > 0) {
        throw new Error(`Invalid field(s) for PATCH booking: ${invalid.join(", ")}`);
      }
      return true;
    }),
  body("address").optional().trim().isLength({ max: 500 }).withMessage("address too long"),
  body("date")
    .optional()
    .trim()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage("date must be YYYY-MM-DD"),
  body("start_time").optional().trim().isLength({ max: 8 }).withMessage("start_time too long"),
  body("end_time").optional().trim().isLength({ max: 8 }).withMessage("end_time too long"),
  body("customer_address_lat").optional().isFloat({ min: -90, max: 90 }),
  body("customer_address_lng").optional().isFloat({ min: -180, max: 180 }),
  body("transport_fee").optional().isFloat({ min: 0 }),
  body("transport_distance_km").optional().isFloat({ min: 0 }),
];
