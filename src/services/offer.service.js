import { supabaseAdmin as supabase } from "../config/supabase.js";

// 🧠 DB → DTO (iOS Offer)
function mapOfferRowToDto(row) {
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    category: row.category,
    categories: row.categories || (row.category ? [row.category] : []), // 🆕 Support multiple categories
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
    // 🆕 Nombre de candidatures (depuis offers_with_counts)
    applicationsCount: row.applications_count ?? 0,
    // 🆕 Flag pour indiquer si une candidature est acceptée
    hasAcceptedApplication: row.has_accepted_application ?? false,
    startDate: row.start_date || null,
    endDate: row.end_date || null,
    vehicleTypes: row.vehicle_types || null,
    prerequisites: row.prerequisites || null,
    isUrgent: row.is_urgent ?? false,
    interventionMode: row.intervention_mode || null,
  };
}

// 🟦 LIST – GET /api/v1/offers?status=&type=
// Par défaut, ne retourne QUE les offres "open" (pour les detailers)
// Les offres "closed" ne sont pas visibles dans OffersView
// 🆕 Exclut automatiquement les offres avec candidature acceptée
export async function getOffers({ status, type }) {
  let query = supabase.from("offers_with_counts").select("*");

  // 🔒 SÉCURITÉ : Par défaut, ne montrer que les offres "open"
  // Si status est explicitement fourni, utiliser celui-ci
  if (status) {
    query = query.eq("status", status);
  } else {
    // Par défaut, seulement les offres ouvertes (pour les detailers)
    query = query.eq("status", "open");
  }
  
  if (type) {
    query = query.eq("type", type);
  }

  // 🆕 EXCLURE les offres avec candidature acceptée (pour OffersView et dashboard company)
  // Ces offres ne doivent plus être visibles car elles sont déjà attribuées
  // Utiliser .or() pour inclure les valeurs NULL (nouvelles offres sans candidature)
  query = query.or("has_accepted_application.eq.false,has_accepted_application.is.null");

  console.log("[OFFERS] getOffers query - status:", status || "open", "type:", type || "all");

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    console.error("[OFFERS] getOffers error:", error);
    throw error;
  }

  console.log("[OFFERS] getOffers returned", data.length, "offers");
  if (data.length > 0) {
    console.log("[OFFERS] First offer:", {
      id: data[0].id,
      title: data[0].title,
      status: data[0].status,
      has_accepted_application: data[0].has_accepted_application,
    });
  }

  return data.map(mapOfferRowToDto);
}

// 🟦 DETAIL – GET /api/v1/offers/:id
export async function getOfferById(id) {
  const { data, error } = await supabase
    .from("offers_with_counts")
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

  // 🔥 Support pour catégories multiples (array) ou une seule (string) pour compatibilité
  let categoryValue;
  let categoriesArray = [];
  
  if (Array.isArray(payload.categories) && payload.categories.length > 0) {
    // Si plusieurs catégories → on prend la première pour la colonne category (compatibilité)
    // et on stocke toutes les catégories dans un champ JSON/array si la DB le supporte
    categoryValue = payload.categories[0];
    categoriesArray = payload.categories;
  } else if (payload.category) {
    // Compatibilité avec l'ancien format
    categoryValue = payload.category;
    categoriesArray = [payload.category];
  } else {
    categoryValue = "carCleaning"; // Fallback
    categoriesArray = ["carCleaning"];
  }

  const insertPayload = {
    title: payload.title,
    category: categoryValue, // Première catégorie pour compatibilité avec la colonne existante
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
    // Dates optionnelles
    start_date: payload.startDate || null,
    end_date: payload.endDate || null,
    // Types de véhicules, prérequis, urgent, mode d'intervention (optionnel)
    vehicle_types: Array.isArray(payload.vehicleTypes) ? payload.vehicleTypes : null,
    prerequisites: Array.isArray(payload.prerequisites) ? payload.prerequisites : null,
    is_urgent: payload.isUrgent === true,
    intervention_mode: payload.interventionMode || null,
  };

  // 🔥 Ajouter categories seulement si la colonne existe (sinon on ignore silencieusement)
  // Si la migration n'est pas encore appliquée, on stocke seulement dans category
  if (categoriesArray.length > 0) {
    insertPayload.categories = categoriesArray;
  }

  console.log("[OFFERS] Creating offer with payload:", {
    title: insertPayload.title,
    category: insertPayload.category,
    categories: insertPayload.categories,
    vehicle_count: insertPayload.vehicle_count,
    price_min: insertPayload.price_min,
    price_max: insertPayload.price_max,
    city: insertPayload.city,
    type: insertPayload.type,
  });

  const { data, error } = await supabase
    .from("offers")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    console.error("[OFFERS] Insert error:", error);
    if (error.code === "42703") {
      const msg = error.message || "";
      if (msg.includes("categories")) {
        delete insertPayload.categories;
      }
      if (msg.includes("vehicle_types") || msg.includes("prerequisites") || msg.includes("is_urgent") || msg.includes("intervention_mode")) {
        delete insertPayload.vehicle_types;
        delete insertPayload.prerequisites;
        delete insertPayload.is_urgent;
        delete insertPayload.intervention_mode;
      }
      const { data: retryData, error: retryError } = await supabase
        .from("offers")
        .insert(insertPayload)
        .select("*")
        .single();
      if (!retryError) return mapOfferRowToDto(retryData);
      console.error("[OFFERS] Retry insert error:", retryError);
    }
    throw error;
  }

  console.log("[OFFERS] Offer created successfully:", {
    id: data.id,
    title: data.title,
    category: data.category,
    categories: data.categories,
    status: data.status,
    created_by: data.created_by,
  });

  // ✅ Récupérer l'offre depuis la vue offers_with_counts pour avoir tous les champs (applications_count, etc.)
  // Cela garantit la cohérence avec les autres endpoints qui utilisent cette vue
  // Attendre un peu pour que la vue soit mise à jour (PostgreSQL peut avoir un léger délai)
  await new Promise(resolve => setTimeout(resolve, 100)); // 100ms de délai
  
  const { data: viewData, error: viewError } = await supabase
    .from("offers_with_counts")
    .select("*")
    .eq("id", data.id)
    .single();

  if (viewError) {
    console.warn("[OFFERS] Could not fetch offer from view, using direct data:", viewError);
    // Fallback : utiliser les données directes si la vue échoue
    // Ajouter les champs manquants pour la compatibilité
    const fallbackData = {
      ...data,
      applications_count: 0,
      has_accepted_application: false,
      company_name: data.company_name,
      company_logo_url: data.company_logo_url,
    };
    return mapOfferRowToDto(fallbackData);
  }

  console.log("[OFFERS] Offer fetched from view:", {
    id: viewData.id,
    status: viewData.status,
    has_accepted_application: viewData.has_accepted_application,
    applications_count: viewData.applications_count,
  });

  return mapOfferRowToDto(viewData);
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
    start_date: payload.startDate,
    end_date: payload.endDate,
    vehicle_types: payload.vehicleTypes,
    prerequisites: payload.prerequisites,
    is_urgent: payload.isUrgent,
    intervention_mode: payload.interventionMode,
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

  // 2) LOGIQUE MÉTIER : Vérifier s'il y a des candidatures acceptées
  const { data: acceptedApps, error: appsError } = await supabase
    .from("applications")
    .select("id")
    .eq("offer_id", id)
    .eq("status", "accepted");

  if (appsError) throw appsError;

  // 🚫 RÈGLE : Ne pas supprimer une offre qui a une candidature acceptée
  if (acceptedApps && acceptedApps.length > 0) {
    const err = new Error(
      "Cannot delete offer that has an accepted application. Close it instead."
    );
    err.statusCode = 400;
    throw err;
  }

  // 3) 🔄 REFUSER AUTOMATIQUEMENT toutes les candidatures en attente
  // Si l'offre a des candidatures (submitted, underReview), les refuser automatiquement
  const { data: pendingApps, error: pendingError } = await supabase
    .from("applications")
    .select("id")
    .eq("offer_id", id)
    .in("status", ["submitted", "underReview"]);

  if (pendingError) {
    console.warn("[OFFERS] Error checking pending applications:", pendingError);
  }

  if (pendingApps && pendingApps.length > 0) {
    console.log(`🔄 [OFFERS] Refusing ${pendingApps.length} pending application(s) for offer ${id}`);
    
    const { error: refuseError } = await supabase
      .from("applications")
      .update({
        status: "refused",
        updated_at: new Date().toISOString(),
      })
      .eq("offer_id", id)
      .in("status", ["submitted", "underReview"]);

    if (refuseError) {
      console.warn("[OFFERS] Error refusing pending applications:", refuseError);
      // Ne pas faire échouer la suppression si cette étape échoue
    } else {
      console.log(`✅ [OFFERS] ${pendingApps.length} application(s) automatically refused`);
    }
  }

  // 4) Suppression de l'offre
  const { error } = await supabase
    .from("offers")
    .delete()
    .eq("id", id);

  if (error) throw error;

  return true;
}

// 🟦 REOPEN – POST /api/v1/offers/:id/reopen (ROLE: company)
// Rouvre une offre fermée (change le statut de "closed" à "open")
// Permet à la company de remettre une offre en ligne manuellement
export async function reopenOffer(id, user) {
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

  // 2) Vérifier que l'offre est bien fermée
  if (existing.status !== "closed") {
    const err = new Error(`Offer is not closed. Current status: ${existing.status}`);
    err.statusCode = 400;
    throw err;
  }

  // 3) Vérifier qu'il n'y a pas de candidature acceptée
  // Si une candidature est acceptée, l'offre ne peut pas être rouverte
  const { data: acceptedApps, error: appsError } = await supabase
    .from("applications")
    .select("id")
    .eq("offer_id", id)
    .eq("status", "accepted");

  if (appsError) throw appsError;

  if (acceptedApps && acceptedApps.length > 0) {
    const err = new Error(
      "Cannot reopen offer that has an accepted application. The offer must remain closed."
    );
    err.statusCode = 400;
    throw err;
  }

  // 4) Rouvrir l'offre
  const { data, error } = await supabase
    .from("offers")
    .update({ 
      status: "open",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return mapOfferRowToDto(data);
}

// 🟦 GET MY OFFERS – GET /api/v1/offers/my (ROLE: company)
// Retourne TOUTES les offres de la company (y compris "closed")
// Utilisé dans le dashboard company "Mes offres"
// 🆕 Exclut les offres avec candidature acceptée (ne doivent plus être visibles visuellement)
export async function getMyOffers(userId) {
  const { data, error } = await supabase
    .from("offers_with_counts")
    .select("*")
    .eq("created_by", userId)
    // 🆕 EXCLURE les offres avec candidature acceptée (pour le dashboard company)
    // Utiliser .or() pour inclure les valeurs NULL (nouvelles offres sans candidature)
    .or("has_accepted_application.eq.false,has_accepted_application.is.null")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data.map(mapOfferRowToDto);
}
