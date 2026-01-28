import { supabaseAdmin as supabase } from "../config/supabase.js";

// DB → DTO (iOS Application)
export function mapApplicationRowToDto(row) {
  if (!row) return null;

  return {
    id: row.id,
    offerId: row.offer_id,
    providerId: row.provider_id,
    message: row.message ?? null, // Message humain (optionnel)
    proposedPrice: row.proposed_price ? Number(row.proposed_price) : null, // Contre-proposition detailer
    finalPrice: row.final_price ? Number(row.final_price) : null, // Prix final accepté par company
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

  // 0.5) ✅ VÉRIFIER QUE LE DETAILER A UN STRIPE CONNECTED ACCOUNT CONFIGURÉ
  // Le detailer doit avoir complété l'onboarding Stripe Connect avec son IBAN
  // AVANT de pouvoir postuler à une offre (pour recevoir les paiements)
  // On récupère aussi display_name pour éviter une deuxième requête
  const { data: providerProfile, error: providerError } = await supabase
    .from("provider_profiles")
    .select("stripe_account_id, display_name")
    .eq("user_id", user.id)
    .single();

  if (providerError || !providerProfile?.stripe_account_id) {
    const err = new Error("Stripe Connect account not configured. Please complete Stripe Connect onboarding with your IBAN before applying to offers.");
    err.statusCode = 400;
    throw err;
  }

  // Vérifier que le Connected Account est actif (charges_enabled et payouts_enabled)
  try {
    const { getConnectedAccountStatus } = await import("./stripeConnect.service.js");
    const accountStatus = await getConnectedAccountStatus(providerProfile.stripe_account_id);
    
    if (!accountStatus.chargesEnabled || !accountStatus.payoutsEnabled) {
      const err = new Error("Stripe Connect account is not fully activated. Please complete the onboarding process to enable payments before applying to offers.");
      err.statusCode = 400;
      throw err;
    }
    
    console.log(`✅ [APPLICATIONS] Provider ${user.id} has active Stripe Connect account: ${providerProfile.stripe_account_id}`);
  } catch (statusError) {
    console.error("[APPLICATIONS] Error checking Connected Account status:", statusError);
    const err = new Error("Could not verify Stripe Connect account status. Please ensure your account is properly configured before applying to offers.");
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

  const nowIso = new Date().toISOString();

  const insertPayload = {
    offer_id: offerId,
    provider_id: user.id,
    message: payload.message ?? null, // Message humain (optionnel)
    proposed_price: payload.proposedPrice ? Number(payload.proposedPrice) : null, // Contre-proposition prix (optionnel)
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



// 🟦 ACCEPT – POST /applications/:id/accept  (company)
// Accepte une candidature et prépare la création du Mission Agreement
export async function acceptApplication(id, finalPrice, depositPercentage, user) {
  // 1) Récupérer l'application
  const { data: appRow, error: appError } = await supabase
    .from("applications")
    .select("id, offer_id, provider_id, proposed_price, status")
    .eq("id", id)
    .single();

  if (appError) throw appError;
  if (!appRow) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    throw err;
  }

  // 2) Vérifier que l'offre appartient à cette company
  const { data: offerRow, error: offerError } = await supabase
    .from("offers")
    .select("id, created_by, title, description, vehicle_count, city, postal_code")
    .eq("id", appRow.offer_id)
    .single();

  if (offerError) throw offerError;
  if (!offerRow || offerRow.created_by !== user.id) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  // 🚫 RÈGLE : impossible d'accepter une application retirée ou déjà acceptée/refusée
  if (appRow.status === "withdrawn") {
    const err = new Error("Cannot accept an application that was withdrawn by the provider");
    err.statusCode = 400;
    throw err;
  }

  if (appRow.status === "accepted" || appRow.status === "refused") {
    const err = new Error("Application is already finalized (" + appRow.status + ")");
    err.statusCode = 400;
    throw err;
  }

  // 3) Calculer les montants (acompte et solde)
  const price = finalPrice ?? appRow.proposed_price ?? null;
  if (!price || price <= 0) {
    const err = new Error("Final price must be provided and greater than 0");
    err.statusCode = 400;
    throw err;
  }

  const depositPct = depositPercentage ?? 30; // Par défaut 30%
  const depositAmount = Math.round((price * depositPct) / 100 * 100) / 100; // Arrondi à 2 décimales
  const remainingAmount = Math.round((price - depositAmount) * 100) / 100;

  // 4) Mettre à jour l'application (statut + prix final)
  const { error: updateError } = await supabase
    .from("applications")
    .update({
      status: "accepted",
      final_price: price,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError) throw updateError;

  // 5) Rejeter automatiquement toutes les autres candidatures pour cette offre
  const { error: rejectOthersError } = await supabase
    .from("applications")
    .update({
      status: "refused",
      updated_at: new Date().toISOString(),
    })
    .eq("offer_id", appRow.offer_id)
    .neq("id", id)
    .eq("status", "submitted"); // Seulement celles en attente

  if (rejectOthersError) {
    console.warn("[APPLICATIONS] Error rejecting other applications:", rejectOthersError);
    // Ne pas faire échouer l'acceptation si cette étape échoue
  }

  // 6) 🔒 FERMER AUTOMATIQUEMENT L'OFFRE (règle métier)
  // Quand une candidature est acceptée, l'offre devient "closed"
  // Elle n'apparaît plus dans OffersView pour les detailers
  // Elle reste visible dans "Mes offres" du dashboard company
  const { error: closeOfferError } = await supabase
    .from("offers")
    .update({
      status: "closed",
      // ⚠️ Ne pas mettre à jour updated_at si la colonne n'existe pas
      // La table offers peut ne pas avoir cette colonne
    })
    .eq("id", appRow.offer_id);

  if (closeOfferError) {
    console.error("[APPLICATIONS] Error closing offer:", closeOfferError);
    // ⚠️ Si l'erreur est PGRST204 (colonne n'existe pas), on continue quand même
    // Sinon, on lance l'erreur car c'est critique
    if (closeOfferError.code !== "PGRST204") {
      throw new Error("Failed to close offer after accepting application");
    } else {
      console.warn("[APPLICATIONS] Column 'updated_at' does not exist in 'offers' table, continuing anyway");
    }
  }

  console.log(`✅ [APPLICATIONS] Offer ${appRow.offer_id} automatically closed after accepting application ${id}`);

  // 7) Retourner les données pour créer le Mission Agreement (sera fait dans le controller)
  return {
    success: true,
    applicationId: id,
    offerId: appRow.offer_id,
    companyId: user.id,
    detailerId: appRow.provider_id,
    finalPrice: price,
    depositPercentage: depositPct,
    depositAmount,
    remainingAmount,
    offerTitle: offerRow.title,
    offerDescription: offerRow.description,
    vehicleCount: offerRow.vehicle_count,
    city: offerRow.city,
    postalCode: offerRow.postal_code,
  };
}

export async function refuseApplication(id, user) {
  return setApplicationStatusAsCompany(id, "refused", user);
}

// 🟦 GET MY APPLICATIONS – GET /api/v1/applications/me (provider)
// 🆕 Exclut les candidatures refusées (ne doivent plus apparaître dans "Mes candidatures")
export async function getMyApplications(userId) {
  // 🆕 Essayer d'abord avec la relation, si ça échoue, récupérer les offres séparément
  let data, error;
  
  try {
    const result = await supabase
      .from("applications")
      .select(`
        *,
        offers!applications_offer_id_fkey(
          id,
          title,
          description,
          city,
          postal_code,
          price_min,
          price_max,
          vehicle_count,
          category,
          categories,
          type,
          status,
          company_name,
          company_logo_url
        )
      `)
      .eq("provider_id", userId)
      // 🆕 EXCLURE les candidatures refusées
      .neq("status", "refused")
      .order("created_at", { ascending: false });
    
    data = result.data;
    error = result.error;
  } catch (err) {
    console.warn("[APPLICATIONS] Error with relation, trying without:", err);
    // Fallback : récupérer sans la relation
    const result = await supabase
      .from("applications")
      .select("*")
      .eq("provider_id", userId)
      .neq("status", "refused")
      .order("created_at", { ascending: false });
    
    data = result.data;
    error = result.error;
  }

  if (error) {
    console.error("[APPLICATIONS] getMyApplications error:", error);
    throw error;
  }

  // 🆕 Si on n'a pas les offres via la relation, les récupérer séparément
  const applications = (data || []).map(row => {
    let offerRow = null;
    
    // Essayer de récupérer l'offre depuis la relation
    if (row.offers) {
      offerRow = Array.isArray(row.offers) ? row.offers[0] : row.offers;
    }
    
    // Si pas d'offre via relation, on retourne quand même l'application (sans offer)
    return {
      ...mapApplicationRowToDto(row),
      offer: offerRow ? {
        id: offerRow.id,
        title: offerRow.title,
        description: offerRow.description,
        city: offerRow.city,
        postalCode: offerRow.postal_code,
        priceMin: offerRow.price_min,
        priceMax: offerRow.price_max,
        vehicleCount: offerRow.vehicle_count,
        category: offerRow.category,
        categories: offerRow.categories || (offerRow.category ? [offerRow.category] : []), // 🆕 Support multiple categories
        type: offerRow.type,
        status: offerRow.status,
        companyName: offerRow.company_name,
        companyLogoUrl: offerRow.company_logo_url,
      } : null,
    };
  });
  
  return applications;
}
