import { Router } from "express";
import { cleanupExpiredBookings } from "../services/booking.service.js";

const router = Router();

router.post("/cleanup-bookings", async (req, res) => {
  const cronSecret = req.headers["x-cron-secret"];

  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const deletedCount = await cleanupExpiredBookings();
    return res.json({
      success: true,
      deleted_count: deletedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[CRON] cleanup error:", err);
    return res.status(500).json({ error: "Cleanup failed" });
  }
});

export default router;
