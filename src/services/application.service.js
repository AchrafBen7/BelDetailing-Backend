import { supabaseAdmin as supabase } from "../config/supabase.js";

// DB → DTO (iOS Application)
function mapApplicationRowToDto(row) {
  if (!row) return null;

  return {
    id: row.id,
    offerId: row.offer_id,
    providerId: row.provider_id,
    message: row.message,
    attachments: row.attachments ?? null, // JSON array → [Attachment]
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    providerName: row.provider_name,
    ratingAfterContract: row.rating_after_contract,
  };
}

// 🟦 LIST – GET /offers/:offerId/applications (company)
export async function getApplicationsForOffer(offerId) {
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("offer_id", offerId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data.map(mapApplicationRowToDto);
}

// 🟦 APPLY – POST /offers/:offerId/apply (provider)
export async function applyToOffer(offerId, payload, user) {
  // 0) Vérifier que l'offre existe et est encore "open"
  const { data: offerRow, error: offerError } = await supabase
    .from("offers")
    .select("id, status")
    .eq("id", offerId)
    .single();

  if (offerError) throw offerError;
  if (!offerRow) {
    const err = new Error("Offer not found");
    err.statusCode = 404;
    throw err;
  }

  if (offerRow.status !== "open") {
    const err = new Error("Offer is not open for applications");
    err.statusCode = 400;
    throw err;
  }

  // 1) Vérifier si ce provider a déjà une application active sur cette offre
  const { data: existingApps, error: existingError } = await supabase
    .from("applications")
    .select("id, status")
    .eq("offer_id", offerId)
    .eq("provider_id", user.id);

  if (existingError) throw existingError;

  const hasActiveApplication =
    (existingApps || []).some(
      (app) => app.status !== "withdrawn" // tout ce qui n'est pas retiré = actif
    );

  if (hasActiveApplication) {
    const err = new Error("Application already exists for this offer");
    err.statusCode = 400;
    throw err;
  }

  // 2) Aller chercher le display_name du provider
  const { data: providerProfile, error: providerErr } = await supabase
    .from("provider_profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (providerErr) {
    console.warn("[APPLICATIONS] provider_profiles lookup error:", providerErr);
  }

  const nowIso = new Date().toISOString();

  const insertPayload = {
    offer_id: offerId,
    provider_id: user.id,
    message: payload.message ?? null,
    attachments: payload.attachments ?? null, // JSON array of Attachment
    status: "submitted",
    provider_name: providerProfile?.display_name ?? null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { data, error } = await supabase
    .from("applications")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) throw error;

  return mapApplicationRowToDto(data);
}


// 🟦 WITHDRAW – POST /applications/:id/withdraw  (provider)
export async function withdrawApplication(id, user) {
  const { data: appRow, error: fetchError } = await supabase
    .from("applications")
    .select("id, provider_id, status")
    .eq("id", id)
    .single();

  if (fetchError) throw fetchError;

  // Pas trouvé ou appartient à un autre provider
  if (!appRow || appRow.provider_id !== user.id) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  // 🚫 RÈGLE : impossible de withdraw si déjà accepté ou refusé
  if (appRow.status === "accepted" || appRow.status === "refused") {
    const err = new Error("Cannot withdraw an application that is already accepted or refused");
    err.statusCode = 400; // bad request (logique métier)
    throw err;
  }

  // Optionnel : si déjà withdrawn → pas besoin de re-modifier
  if (appRow.status === "withdrawn") {
    // on peut soit ne rien faire, soit renvoyer une erreur
    return true; // no-op
  }

  const { error } = await supabase
    .from("applications")
    .update({
      status: "withdrawn",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw error;
  return true;
}


async function setApplicationStatusAsCompany(id, newStatus, user) {
  // 1) on récupère l’application pour connaître offer_id + status actuel
  const { data: appRow, error: appError } = await supabase
    .from("applications")
    .select("id, offer_id, status")
    .eq("id", id)
    .single();

  if (appError) throw appError;
  if (!appRow) {
    const err = new Error("Not found");
    err.statusCode = 404;
    throw err;
  }

  // 2) vérifier que l’offre appartient à cette company
  const { data: offerRow, error: offerError } = await supabase
    .from("offers")
    .select("id, created_by")
    .eq("id", appRow.offer_id)
    .single();

  if (offerError) throw offerError;
  if (!offerRow || offerRow.created_by !== user.id) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  // 🚫 RÈGLE : impossible d'accepter/refuser une application retirée
  if (appRow.status === "withdrawn") {
    const err = new Error("Cannot " + newStatus + " an application that was withdrawn by the provider");
    err.statusCode = 400;
    throw err;
  }

  // 🚫 RÈGLE : si déjà accepté/refusé → on ne change plus
  if (appRow.status === "accepted" || appRow.status === "refused") {
    const err = new Error("Application is already finalized (" + appRow.status + ")");
    err.statusCode = 400;
    throw err;
  }

  const { error } = await supabase
    .from("applications")
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw error;
  return true;
}



export async function acceptApplication(id, user) {
  return setApplicationStatusAsCompany(id, "accepted", user);
}

export async function refuseApplication(id, user) {
  return setApplicationStatusAsCompany(id, "refused", user);
}
