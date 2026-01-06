import { supabaseAdmin as supabase } from "../config/supabase.js";

function toError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function getServiceById(serviceId) {
  const { data, error } = await supabase
    .from("services")
    .select("id, provider_id")
    .eq("id", serviceId)
    .single();

  if (error) throw error;
  return data;
}

export async function getServicePhotos(serviceId) {
  const { data, error } = await supabase
    .from("service_photos")
    .select("*")
    .eq("service_id", serviceId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function addServicePhoto(serviceId, payload, providerId) {
  const imageUrl = payload?.image_url;
  const thumbnailUrl = payload?.thumbnail_url ?? null;

  if (!imageUrl) {
    throw toError("image_url is required", 400);
  }

  const service = await getServiceById(serviceId);
  if (!service) {
    throw toError("Service not found", 404);
  }

  if (providerId && service.provider_id !== providerId) {
    throw toError("Forbidden", 403);
  }

  const { count, error: countError } = await supabase
    .from("service_photos")
    .select("id", { count: "exact", head: true })
    .eq("service_id", serviceId);

  if (countError) throw countError;

  if (typeof count === "number" && count >= 5) {
    throw toError("Maximum 5 photos allowed per service", 400);
  }

  const { data, error } = await supabase
    .from("service_photos")
    .insert({
      service_id: serviceId,
      provider_id: service.provider_id,
      image_url: imageUrl,
      thumbnail_url: thumbnailUrl,
      caption: payload?.caption ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteServicePhoto(serviceId, photoId, providerId) {
  const service = await getServiceById(serviceId);
  if (!service) {
    throw toError("Service not found", 404);
  }

  if (providerId && service.provider_id !== providerId) {
    throw toError("Forbidden", 403);
  }

  const { data, error } = await supabase
    .from("service_photos")
    .delete()
    .eq("id", photoId)
    .eq("service_id", serviceId)
    .eq("provider_id", service.provider_id)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw toError("Photo not found", 404);
  }

  return true;
}
