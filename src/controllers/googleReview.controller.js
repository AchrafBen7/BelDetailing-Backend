import { supabaseAdmin as supabase } from "../config/supabase.js";
import {
  createReviewPrompt,
  trackReviewRating,
  trackGoogleRedirect,
  dismissReviewPrompt,
  getReviewPromptForBooking,
} from "../services/googleReview.service.js";

export async function createReviewPromptController(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { booking_id } = req.body;

    if (!booking_id) {
      return res.status(400).json({ error: "Missing booking_id" });
    }

    if (userRole !== "customer") {
      return res.status(403).json({
        error: "Only customers can create review prompts",
      });
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, customer_id, provider_id, status")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.customer_id !== userId) {
      return res.status(403).json({ error: "This is not your booking" });
    }

    if (booking.status !== "completed") {
      return res.status(400).json({
        error: "Booking must be completed to prompt for review",
      });
    }

    const { data: provider, error: providerError } = await supabase
      .from("provider_profiles")
      .select("user_id, google_place_id")
      .eq("user_id", booking.provider_id)
      .maybeSingle();

    if (providerError) {
      console.warn("[REVIEW] Error fetching provider:", providerError);
    }

    const prompt = await createReviewPrompt({
      booking_id: booking_id,
      customer_id: userId,
      provider_id: booking.provider_id,
      google_place_id: provider?.google_place_id || null,
    });

    return res.status(201).json({ data: prompt });
  } catch (err) {
    console.error("[REVIEW] createPrompt error:", err);
    return res.status(500).json({ error: "Could not create review prompt" });
  }
}

export async function getReviewPromptController(req, res) {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole !== "customer") {
      return res.status(403).json({
        error: "Only customers can view review prompts",
      });
    }

    const prompt = await getReviewPromptForBooking(bookingId, userId);

    if (!prompt) {
      return res.status(404).json({ error: "Review prompt not found" });
    }

    return res.json({ data: prompt });
  } catch (err) {
    console.error("[REVIEW] getPrompt error:", err);
    return res.status(500).json({ error: "Could not fetch review prompt" });
  }
}

export async function trackRatingController(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        error: "Rating must be between 1 and 5",
      });
    }

    const { data: prompt, error: promptError } = await supabase
      .from("review_prompts")
      .select("customer_id")
      .eq("id", id)
      .single();

    if (promptError || !prompt) {
      return res.status(404).json({ error: "Review prompt not found" });
    }

    if (prompt.customer_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await trackReviewRating(id, rating);
    return res.json({ success: true });
  } catch (err) {
    console.error("[REVIEW] trackRating error:", err);
    return res.status(500).json({ error: "Could not track rating" });
  }
}

export async function trackGoogleRedirectController(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: prompt, error: promptError } = await supabase
      .from("review_prompts")
      .select("customer_id, google_place_id")
      .eq("id", id)
      .single();

    if (promptError || !prompt) {
      return res.status(404).json({ error: "Review prompt not found" });
    }

    if (prompt.customer_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await trackGoogleRedirect(id);

    return res.json({
      success: true,
      google_place_id: prompt.google_place_id,
    });
  } catch (err) {
    console.error("[REVIEW] trackRedirect error:", err);
    return res.status(500).json({ error: "Could not track redirect" });
  }
}

export async function dismissPromptController(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: prompt, error: promptError } = await supabase
      .from("review_prompts")
      .select("customer_id")
      .eq("id", id)
      .single();

    if (promptError || !prompt) {
      return res.status(404).json({ error: "Review prompt not found" });
    }

    if (prompt.customer_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await dismissReviewPrompt(id);
    return res.json({ success: true });
  } catch (err) {
    console.error("[REVIEW] dismissPrompt error:", err);
    return res.status(500).json({ error: "Could not dismiss prompt" });
  }
}
