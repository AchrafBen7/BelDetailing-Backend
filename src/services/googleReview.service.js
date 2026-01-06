import { supabaseAdmin as supabase } from "../config/supabase.js";

export async function createReviewPrompt({
  booking_id,
  customer_id,
  provider_id,
  google_place_id,
}) {
  const { data: existing, error: findError } = await supabase
    .from("review_prompts")
    .select("*")
    .eq("booking_id", booking_id)
    .maybeSingle();

  if (findError) throw findError;

  if (existing) {
    return existing;
  }

  const { data: created, error: createError } = await supabase
    .from("review_prompts")
    .insert({
      booking_id,
      customer_id,
      provider_id,
      google_place_id,
    })
    .select("*")
    .single();

  if (createError) throw createError;
  return created;
}

export async function trackReviewRating(promptId, rating) {
  const { error } = await supabase
    .from("review_prompts")
    .update({
      rating_selected: rating,
      updated_at: new Date().toISOString(),
    })
    .eq("id", promptId);

  if (error) throw error;
  return true;
}

export async function trackGoogleRedirect(promptId) {
  const { error } = await supabase
    .from("review_prompts")
    .update({
      google_redirected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", promptId);

  if (error) throw error;
  return true;
}

export async function dismissReviewPrompt(promptId) {
  const { error } = await supabase
    .from("review_prompts")
    .update({
      dismissed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", promptId);

  if (error) throw error;
  return true;
}

export async function getReviewPromptForBooking(bookingId, customerId) {
  const { data, error } = await supabase
    .from("review_prompts")
    .select("*")
    .eq("booking_id", bookingId)
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) throw error;
  return data;
}
