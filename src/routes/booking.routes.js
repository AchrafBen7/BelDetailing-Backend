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
  startService,
  updateProgress,
  completeService,
  counterPropose,
  acceptCounterProposal,
  refuseCounterProposal,
  cleanupExpiredBookingsController,
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
router.post("/:id/start", requireAuth, startService);
router.post("/:id/progress", requireAuth, updateProgress);
router.post("/:id/complete", requireAuth, completeService);
router.post("/:id/counter-propose", requireAuth, counterPropose);
router.post("/:id/accept-counter-proposal", requireAuth, acceptCounterProposal);
router.post("/:id/refuse-counter-proposal", requireAuth, refuseCounterProposal);
router.delete("/expired", requireAuth, cleanupExpiredBookingsController);

export default router;
