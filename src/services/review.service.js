// src/services/review.service.js
import { supabaseAdmin as supabase } from "../config/supabase.js";

export async function createReviewForProvider({ userId, providerId, bookingId, rating, comment }) {
  const payload = {
    provider_id: providerId,
    customer_id: userId,
    booking_id: bookingId ?? null,
    rating,
    comment,
  };

  const { data, error } = await supabase
    .from("reviews")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const { data: ratings, error: ratingsError } = await supabase
    .from("reviews")
    .select("rating")
    .eq("provider_id", providerId);

  if (ratingsError) {
    throw ratingsError;
  }

  const reviewCount = ratings.length;
  const avgRating =
    reviewCount > 0
      ? ratings.reduce((sum, row) => sum + Number(row.rating || 0), 0) / reviewCount
      : 0;

  const { error: updateError } = await supabase
    .from("provider_profiles")
    .update({
      rating: avgRating,
      review_count: reviewCount,
    })
    .eq("id", providerId);

  if (updateError) {
    throw updateError;
  }

  return data;
}
