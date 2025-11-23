// src/services/review.service.js
import { supabase } from "../config/supabase.js";

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

  // TODO plus tard : mettre à jour la moyenne de rating + review_count
  // via une fonction SQL ou un trigger

  return data;
}
