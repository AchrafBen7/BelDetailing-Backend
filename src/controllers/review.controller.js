// src/controllers/review.controller.js
import { createReviewForProvider } from "../services/review.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";

export async function createReview(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { providerId, bookingId, rating, comment } = req.body;

    // 🔒 Validation des champs requis
    if (!providerId || rating == null) {
      return res.status(400).json({ error: "Missing providerId or rating" });
    }

    // 🔒 Rating borné entre 1 et 5
    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ error: "Rating must be an integer between 1 and 5" });
    }

    // 🔒 Commentaire limité à 2000 caractères
    if (comment && typeof comment === "string" && comment.length > 2000) {
      return res.status(400).json({ error: "Comment is too long (max 2000 characters)" });
    }

    // 🔒 Vérifier que le booking existe, appartient au customer, et est completed
    if (bookingId) {
      const { data: booking, error: bookingErr } = await supabase
        .from("bookings")
        .select("id, customer_id, provider_id, status")
        .eq("id", bookingId)
        .maybeSingle();

      if (bookingErr || !booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (booking.customer_id !== userId) {
        return res.status(403).json({ error: "This booking does not belong to you" });
      }

      if (booking.provider_id !== providerId) {
        return res.status(400).json({ error: "Provider does not match this booking" });
      }

      if (booking.status !== "completed") {
        return res.status(400).json({ error: "You can only review completed bookings" });
      }

      // 🔒 Anti-doublon : vérifier qu'il n'y a pas déjà un avis pour ce booking
      const { data: existingReview } = await supabase
        .from("reviews")
        .select("id")
        .eq("booking_id", bookingId)
        .eq("customer_id", userId)
        .maybeSingle();

      if (existingReview) {
        return res.status(400).json({ error: "You already reviewed this booking" });
      }
    }

    const review = await createReviewForProvider({
      userId,
      providerId,
      bookingId,
      rating: numericRating,
      comment: comment ? comment.substring(0, 2000) : null,
    });

    return res.status(201).json({ data: review });
  } catch (err) {
    console.error("[REVIEWS] createReview error:", err);
    return res.status(500).json({ error: "Could not create review" });
  }
}
