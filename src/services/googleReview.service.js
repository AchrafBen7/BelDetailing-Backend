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

/**
 * Récupère les avis Google d'un lieu via l'API Place Details (legacy).
 * @param {string} placeId - Google Place ID (ex. ChIJ...)
 * @returns {Promise<Array<{ author_name: string, rating: number, text: string }>>}
 */
async function fetchGooglePlaceReviews(placeId) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is not set");
  }
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "name,reviews");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const json = await res.json();
  if (json.status !== "OK" && json.status !== "ZERO_RESULTS") {
    throw new Error(json.error_message || json.status || "Google Places API error");
  }
  const reviews = json.result?.reviews || [];
  return reviews.map((r) => ({
    author_name: r.author_name || "Client",
    rating: typeof r.rating === "number" ? Math.min(5, Math.max(1, Math.round(r.rating))) : 5,
    text: r.text || "",
  }));
}

/**
 * Recalcule et met à jour rating + review_count du provider dans provider_profiles.
 * @param {string} providerUserId - user_id du prestataire (provider_id dans reviews)
 */
async function updateProviderRatingFromReviews(providerUserId) {
  const { data: ratings, error } = await supabase
    .from("reviews")
    .select("rating")
    .eq("provider_id", providerUserId);

  if (error) throw error;
  const reviewCount = (ratings || []).length;
  const avgRating =
    reviewCount > 0
      ? (ratings || []).reduce((sum, row) => sum + Number(row.rating || 0), 0) / reviewCount
      : 0;

  const { error: updateError } = await supabase
    .from("provider_profiles")
    .update({
      rating: Math.round(avgRating * 100) / 100,
      review_count: reviewCount,
    })
    .eq("user_id", providerUserId);

  if (updateError) throw updateError;
}

/**
 * Importe les avis Google d'un lieu pour le prestataire connecté.
 * Insère les avis dans reviews (source = 'google_import', author_name, customer_id = null)
 * puis recalcule rating et review_count du provider.
 * @param {string} providerUserId - user_id du prestataire (req.user.id)
 * @param {string} placeId - Google Place ID
 * @returns {Promise<{ imported: number, total: number }>}
 */
export async function importGoogleReviewsForProvider(providerUserId, placeId) {
  const reviews = await fetchGooglePlaceReviews(placeId);
  if (reviews.length === 0) {
    return { imported: 0, total: 0 };
  }

  const { error: deleteError } = await supabase
    .from("reviews")
    .delete()
    .eq("provider_id", providerUserId)
    .eq("source", "google_import");

  if (deleteError) throw deleteError;

  const rows = reviews.map((r) => ({
    provider_id: providerUserId,
    customer_id: null,
    booking_id: null,
    rating: r.rating,
    comment: r.text || null,
    source: "google_import",
    author_name: r.author_name || null,
    created_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("reviews").insert(rows);
  if (error) throw error;

  await updateProviderRatingFromReviews(providerUserId);
  return { imported: rows.length, total: reviews.length };
}
