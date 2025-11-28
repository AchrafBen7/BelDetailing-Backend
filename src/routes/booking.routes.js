// src/routes/booking.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";

import {
  listBookings,
  getBooking,
  createBooking,
  updateBooking,
  cancelBooking,
  confirmBooking,
  declineBooking,
  refundBooking,
} from "../controllers/booking.controller.js";

const router = Router();

router.get("/", requireAuth, listBookings);
router.get("/:id", requireAuth, getBooking);
router.post("/", requireAuth, createBooking);
router.patch("/:id", requireAuth, updateBooking);

router.post("/:id/cancel", requireAuth, cancelBooking);
router.post("/:id/confirm", requireAuth, confirmBooking);
router.post("/:id/decline", requireAuth, declineBooking);

router.post("/:id/refund", requireAuth, refundBooking);

export default router;
