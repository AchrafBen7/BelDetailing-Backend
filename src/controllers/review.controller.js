// src/controllers/review.controller.js
import { createReviewForProvider } from "../services/review.service.js";

export async function createReview(req, res) {
  try {
    const userId = req.user?.sub; // vient de requireAuth
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { providerId, bookingId, rating, comment } = req.body;

    if (!providerId || !rating) {
      return res.status(400).json({ error: "Missing providerId or rating" });
    }

    const review = await createReviewForProvider({
      userId,
      providerId,
      bookingId,
      rating,
      comment,
    });

    // iOS: APIResponse<Review>
    return res.status(201).json(review);
  } catch (err) {
    console.error("[REVIEWS] createReview error:", err);
    return res.status(500).json({ error: "Could not create review" });
  }
}
