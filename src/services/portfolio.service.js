import { supabaseAdmin as supabase } from "../config/supabase.js";

function toError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export async function getProviderPortfolio(providerId) {
  const { data, error } = await supabase
    .from("provider_portfolio_photos")
    .select("*")
    .eq("provider_id", providerId)
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function addPortfolioPhoto(providerId, payload) {
  const imageUrl = payload?.image_url;
  const thumbnailUrl = payload?.thumbnail_url ?? null;

  if (!imageUrl) {
    throw toError("image_url is required", 400);
  }

  const { count, error: countError } = await supabase
    .from("provider_portfolio_photos")
    .select("id", { count: "exact", head: true })
    .eq("provider_id", providerId);

  if (countError) throw countError;

  if (typeof count === "number" && count >= 12) {
    throw toError("Maximum 12 photos allowed per provider portfolio", 400);
  }

  const { data, error } = await supabase
    .from("provider_portfolio_photos")
    .insert({
      provider_id: providerId,
      image_url: imageUrl,
      thumbnail_url: thumbnailUrl,
      caption: payload?.caption ?? null,
      service_category: payload?.service_category ?? null,
      display_order:
        payload?.display_order != null ? Number(payload.display_order) : null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function deletePortfolioPhoto(photoId, providerId) {
  const { data, error } = await supabase
    .from("provider_portfolio_photos")
    .delete()
    .eq("id", photoId)
    .eq("provider_id", providerId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw toError("Photo not found", 404);
  }

  return true;
}

export async function updatePortfolioPhoto(photoId, providerId, updates) {
  const payload = {
    caption: updates?.caption,
    service_category: updates?.service_category,
    display_order:
      updates?.display_order != null ? Number(updates.display_order) : undefined,
    image_url: updates?.image_url,
    thumbnail_url: updates?.thumbnail_url,
  };

  Object.keys(payload).forEach(key => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });

  if (Object.keys(payload).length === 0) {
    throw toError("No valid fields to update", 400);
  }

  const { data, error } = await supabase
    .from("provider_portfolio_photos")
    .update(payload)
    .eq("id", photoId)
    .eq("provider_id", providerId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
