import { supabase } from "../config/supabase.js";

// 🧠 DB → DTO (iOS Offer)
function mapOfferRowToDto(row) {
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    vehicleCount: row.vehicle_count,
    priceMin: row.price_min,
    priceMax: row.price_max,
    city: row.city,
    postalCode: row.postal_code,
    lat: row.lat,
    lng: row.lng,
    type: row.type,
    // 👉 pas de attachments en DB pour offers, iOS champ optionnel
    attachments: null,
    status: row.status,
    contractId: row.contract_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    // applications → chargées via endpoint séparé
    applications: null,
    companyName: row.company_name,
    companyLogoUrl: row.company_logo_url,
  };
}

// 🟦 LIST – GET /api/v1/offers?status=&type=
export async function getOffers({ status, type }) {
  let query = supabase.from("offers").select("*");

  if (status) {
    query = query.eq("status", status);
  }
  if (type) {
    query = query.eq("type", type);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw error;

  return data.map(mapOfferRowToDto);
}

// 🟦 DETAIL – GET /api/v1/offers/:id
export async function getOfferById(id) {
  const { data, error } = await supabase
    .from("offers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return mapOfferRowToDto(data);
}

// 🟦 CREATE – POST /api/v1/offers  (ROLE: company)
export async function createOffer(payload, user) {
  // user.id = companyId
  // On va chercher les infos de company_profiles pour afficher dans l’app
  const { data: companyProfile, error: companyError } = await supabase
    .from("company_profiles")
    .select("legal_name, logo_url")
    .eq("user_id", user.id)
    .maybeSingle();

  if (companyError) {
    console.warn("[OFFERS] company_profiles lookup error:", companyError);
  }

  const insertPayload = {
    title: payload.title,
    category: payload.category, // ex: "carCleaning"
    description: payload.description,
    vehicle_count: payload.vehicleCount,
    price_min: payload.priceMin,
    price_max: payload.priceMax,
    city: payload.city,
    postal_code: payload.postalCode,
    lat: payload.lat ?? null,
    lng: payload.lng ?? null,
    type: payload.type, // ex: "oneTime" | "recurring" | "longTerm"
    status: "open",
    contract_id: null,
    created_by: user.id,
    company_name: companyProfile?.legal_name ?? null,
    company_logo_url: companyProfile?.logo_url ?? null,
  };

  const { data, error } = await supabase
    .from("offers")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) throw error;

  return mapOfferRowToDto(data);
}

// 🟦 UPDATE – PATCH /api/v1/offers/:id  (ROLE: company, owner only)
export async function updateOffer(id, payload, user) {
  // Sécuriser : only owner (created_by = user.id)
  const { data: existing, error: fetchError } = await supabase
    .from("offers")
    .select("id, created_by")
    .eq("id", id)
    .single();

  if (fetchError) throw fetchError;
  if (!existing || existing.created_by !== user.id) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  const updatePayload = {
    title: payload.title,
    category: payload.category,
    description: payload.description,
    vehicle_count: payload.vehicleCount,
    price_min: payload.priceMin,
    price_max: payload.priceMax,
    city: payload.city,
    postal_code: payload.postalCode,
    lat: payload.lat,
    lng: payload.lng,
    type: payload.type,
    status: payload.status, // facultatif, sinon laisser comme avant côté client
  };

  // on enlève les undefined
  Object.keys(updatePayload).forEach((key) => {
    if (updatePayload[key] === undefined) {
      delete updatePayload[key];
    }
  });

  const { data, error } = await supabase
    .from("offers")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return mapOfferRowToDto(data);
}

// 🟦 CLOSE – POST /api/v1/offers/:id/close
// 🟦 CLOSE – POST /api/v1/offers/:id/close
export async function closeOffer(id, user) {
  // 1) Vérifier que l'offre existe et appartient à cette company
  const { data: existing, error: fetchError } = await supabase
    .from("offers")
    .select("id, created_by, status")
    .eq("id", id)
    .single();

  if (fetchError) throw fetchError;

  if (!existing) {
    const err = new Error("Offer not found");
    err.statusCode = 404;
    throw err;
  }

  if (existing.created_by !== user.id) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  // Optionnel : si déjà fermée, on peut soit faire no-op, soit erreur
  if (existing.status === "closed" || existing.status === "archived") {
    const err = new Error("Offer is already closed");
    err.statusCode = 400;
    throw err;
  }

  // 2) Vérifier l'état des candidatures liées
  const { data: apps, error: appsError } = await supabase
    .from("applications")
    .select("id, status")
    .eq("offer_id", id);

  if (appsError) throw appsError;

  const hasPending = (apps || []).some(app =>
    app.status === "submitted" || app.status === "underReview"
  );

  if (hasPending) {
    const err = new Error(
      "Cannot close offer while some applications are still pending. Please accept or refuse them first."
    );
    err.statusCode = 400;
    throw err;
  }

  // 3) Tout est clean (aucune application ou seulement accepted/refused/withdrawn) → on peut fermer
  const { data, error } = await supabase
    .from("offers")
    .update({ status: "closed" })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return mapOfferRowToDto(data);
}



// 🟦 DELETE – DELETE /api/v1/offers/:id
// 🟦 DELETE – DELETE /api/v1/offers/:id
export async function deleteOffer(id, user) {
  // 1) Vérifier que l'offre existe et appartient à cette company
  const { data: existing, error: fetchError } = await supabase
    .from("offers")
    .select("id, created_by, status")
    .eq("id", id)
    .single();

  if (fetchError) throw fetchError;

  if (!existing) {
    const err = new Error("Offer not found");
    err.statusCode = 404;
    throw err;
  }

  if (existing.created_by !== user.id) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  // 2) LOGIQUE MÉTIER : ne pas supprimer une offre qui a déjà un contrat accepté
  const { data: acceptedApps, error: appsError } = await supabase
    .from("applications")
    .select("id")
    .eq("offer_id", id)
    .eq("status", "accepted");

  if (appsError) throw appsError;

  if (acceptedApps && acceptedApps.length > 0) {
    const err = new Error(
      "Cannot delete offer that has an accepted application. Close it instead."
    );
    err.statusCode = 400;
    throw err;
  }

  // 3) Suppression
  const { error } = await supabase
    .from("offers")
    .delete()
    .eq("id", id);

  if (error) throw error;

  return true;
}

