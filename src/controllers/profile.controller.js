
import { mapUserRowToDto } from "../mappers/user.mapper.js";
import { supabase, supabaseAdmin } from "../config/supabase.js";
import { getCompanyReliabilityMetrics } from "../services/companyProfileStats.service.js";

// ⚠️ Toutes les opérations DB dans ce fichier utilisent supabaseAdmin (service role)
// pour contourner RLS et éviter "Cannot coerce" errors.
// supabase (anon) est réservé à l'authentification (signIn, etc.).


// ========= GET PROFILE =========
// Requêtes séparées (sans jointure) pour éviter "Cannot coerce the result to a single JSON object"
// quand des doublons existent dans les tables de profils.
export async function getProfile(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Utiliser supabaseAdmin (service role) pour contourner RLS et lire le profil de l'utilisateur identifié par le JWT
  const { data: userRow, error: userError } = await supabaseAdmin
    .from("users")
    .select(`
      id, email, phone, role, vat_number, is_vat_valid,
      referral_code, referred_by, customer_credits_eur,
      welcoming_offer_used, dismissed_first_booking_offer,
      created_at, updated_at
    `)
    .eq("id", userId)
    .maybeSingle();

  if (userError) {
    console.error("[PROFILE] getProfile users error:", userError.message, userError.code);
    return res.status(500).json({ error: userError.message });
  }
  if (!userRow) {
    return res.status(404).json({ error: "Profile not found" });
  }

  // limit(1) + take first row to avoid "Cannot coerce the result to a single JSON object"
  // when duplicate profile rows exist for the same user_id
  const [customerRes, companyRes, providerRes] = await Promise.all([
    supabaseAdmin.from("customer_profiles").select("first_name, last_name, default_address, preferred_city_id, vehicle_type, service_at_home, home_water, home_electricity, home_space, avatar_url").eq("user_id", userId).limit(1),
    supabaseAdmin.from("company_profiles").select("legal_name, company_type_id, city, postal_code, contact_name, logo_url, commercial_name, bce_number, country, registered_address, legal_representative_name, languages_spoken, currency, sector, fleet_size, main_address, mission_zones, place_types, is_verified, payment_success_rate, late_cancellations_count, open_disputes_count, closed_disputes_count, missions_posted_count, missions_completed_count, detailer_satisfaction_rate, detailer_rating").eq("user_id", userId).limit(1),
    supabaseAdmin.from("provider_profiles").select("display_name, bio, base_city, postal_code, has_mobile_service, has_garage, min_price, rating, services, company_name, lat, lng, review_count, team_size, years_of_experience, logo_url, banner_url, transport_price_per_km, transport_enabled, welcoming_offer_enabled, opening_hours, available_today").eq("user_id", userId).limit(1),
  ]);

  if (customerRes.error) console.warn("[PROFILE] customer_profiles error:", customerRes.error.message);
  if (companyRes.error) console.warn("[PROFILE] company_profiles error:", companyRes.error.message);
  if (providerRes.error) console.warn("[PROFILE] provider_profiles error:", providerRes.error.message);

  const data = {
    ...userRow,
    customer_profiles: customerRes.data?.length ? [customerRes.data[0]] : [],
    company_profiles: companyRes.data?.length ? [companyRes.data[0]] : [],
    provider_profiles: providerRes.data?.length ? [providerRes.data[0]] : [],
  };

  try {
    const userDto = mapUserRowToDto(data);

  // Enrichir le profil Company avec les métriques calculées (fiabilité / historique)
  if (data.role === "company" && userDto.companyProfile) {
    try {
      const metrics = await getCompanyReliabilityMetrics(userId);
      userDto.companyProfile.missionsPostedCount = metrics.missionsPostedCount;
      userDto.companyProfile.missionsCompletedCount = metrics.missionsCompletedCount;
      userDto.companyProfile.paymentSuccessRate = metrics.paymentSuccessRate;
      userDto.companyProfile.lateCancellationsCount = metrics.lateCancellationsCount;
      userDto.companyProfile.openDisputesCount = metrics.openDisputesCount;
      userDto.companyProfile.detailerSatisfactionRate = metrics.detailerSatisfactionRate;
      userDto.companyProfile.detailerRating = metrics.detailerRating;
    } catch (metricsErr) {
      console.warn("[PROFILE] Company metrics error:", metricsErr.message);
    }
  }

  return res.json({ user: userDto });
} catch (err) {
  console.error("❌ DTO MAPPING ERROR:", err);
  return res.status(500).json({ error: "Mapping failed" });
}


  
}

// ========= UPDATE PROFILE =========
export async function updateProfile(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ✅ Récupérer le rôle actuel de l'utilisateur
  const { data: currentUser, error: currentUserError } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();
  
  if (currentUserError) {
    return res.status(500).json({ error: currentUserError.message });
  }

  const {
    phone,
    vatNumber,
    isVatValid,
    dismissedFirstBookingOffer,
    customerProfile,
    companyProfile,
    providerProfile,
    role: bodyRole,
  } = req.body;

  // Sécurité : rejet explicite si le client envoie "role" (sauf transition provider_passionate → provider ci-dessous)
  if (bodyRole !== undefined && currentUser?.role !== "provider_passionate") {
    return res.status(400).json({ error: "Cannot change role via profile update" });
  }

  // ✅ TRANSITION : Si un provider_passionate ajoute une TVA, passer en Pro
  if (currentUser?.role === "provider_passionate" && vatNumber && vatNumber.trim() !== "") {
    // Vérifier que la TVA n'est pas vide (validation basique)
    if (vatNumber.trim().length < 8) {
      return res.status(400).json({ error: "Invalid VAT number format" });
    }
    
    // Mettre à jour le rôle vers "provider"
    const { error: roleError } = await supabaseAdmin
      .from("users")
      .update({
        role: "provider",
        vat_number: vatNumber.trim(),
        is_vat_valid: false, // Sera validé plus tard via un service de validation
      })
      .eq("id", userId);
    
    if (roleError) {
      return res.status(500).json({ error: roleError.message });
    }
    
    // Réinitialiser le plafond (plus nécessaire pour les Pros)
    await supabaseAdmin
      .from("provider_profiles")
      .update({
        annual_revenue_limit: null,
        annual_revenue_current: null,
        annual_revenue_year: null,
      })
      .eq("user_id", userId);
    
    // 🔒 SECURITY: Ne pas logger le numéro de TVA complet
    console.log(`✅ [PROFILE] Provider_passionate ${userId} upgraded to provider`);
    
    // Retourner le profil mis à jour
    return await getProfile(req, res);
  }

  // 1) Update table users (role non modifiable ici – uniquement via transition provider_passionate → provider ci-dessus)
  // 🔒 SECURITY: isVatValid ne doit JAMAIS être modifiable par l'utilisateur.
  //    Seul le backend VAT validation peut le setter.
  const userUpdate = {};
  if (phone !== undefined) userUpdate.phone = phone;
  if (vatNumber !== undefined) userUpdate.vat_number = vatNumber;
  // isVatValid intentionnellement exclu — seul le service de validation TVA peut le modifier
  if (dismissedFirstBookingOffer !== undefined) userUpdate.dismissed_first_booking_offer = dismissedFirstBookingOffer === true;

  if (Object.keys(userUpdate).length > 0) {
    const { error: userError } = await supabaseAdmin
      .from("users")
      .update(userUpdate)
      .eq("id", userId);

    if (userError) {
      return res.status(500).json({ error: userError.message });
    }
  }

  // 🔒 SECURITY: Empêcher la création de profils cross-role
  // Un customer ne peut pas créer un providerProfile ou companyProfile, etc.
  const userRole = currentUser?.role;
  if (customerProfile && !["customer"].includes(userRole)) {
    return res.status(403).json({ error: "Cannot update customer profile with your current role" });
  }
  if (companyProfile && !["company"].includes(userRole)) {
    return res.status(403).json({ error: "Cannot update company profile with your current role" });
  }
  if (providerProfile && !["provider", "provider_passionate"].includes(userRole)) {
    return res.status(403).json({ error: "Cannot update provider profile with your current role" });
  }

  // 2) Update / upsert customer_profile
  if (customerProfile) {
    const {
      firstName,
      lastName,
      defaultAddress,
      preferredCityId,
      vehicleType,
      serviceAtHome,
      homeWater,
      homeElectricity,
      homeSpace,
      avatarUrl,
    } = customerProfile;

    const { error: customerError } = await supabaseAdmin
      .from("customer_profiles")
      .upsert(
        {
          user_id: userId,
          first_name: firstName,
          last_name: lastName,
          default_address: defaultAddress,
          preferred_city_id: preferredCityId,
          vehicle_type: vehicleType,
          service_at_home: serviceAtHome === true,
          home_water: homeWater === true,
          home_electricity: homeElectricity === true,
          home_space: homeSpace === true,
          avatar_url: avatarUrl ?? null,
        },
        { onConflict: "user_id" }
      );

    if (customerError) {
      return res.status(500).json({ error: customerError.message });
    }
  }

  // 3) Update / upsert company_profile (identité légale, confiance, localisation)
  if (companyProfile) {
    const {
      legalName,
      companyTypeId,
      city,
      postalCode,
      contactName,
      logoUrl,
      commercialName,
      bceNumber,
      country,
      registeredAddress,
      legalRepresentativeName,
      languagesSpoken,
      currency,
      sector,
      fleetSize,
      mainAddress,
      missionZones,
      placeTypes,
    } = companyProfile;

    const { error: companyError } = await supabaseAdmin
      .from("company_profiles")
      .upsert(
        {
          user_id: userId,
          legal_name: legalName,
          company_type_id: companyTypeId,
          city,
          postal_code: postalCode,
          contact_name: contactName,
          logo_url: logoUrl,
          commercial_name: commercialName,
          bce_number: bceNumber,
          country,
          registered_address: registeredAddress,
          legal_representative_name: legalRepresentativeName,
          languages_spoken: languagesSpoken,
          currency,
          sector,
          fleet_size: fleetSize,
          main_address: mainAddress,
          mission_zones: missionZones,
          place_types: placeTypes,
        },
        { onConflict: "user_id" }
      );

    if (companyError) {
      return res.status(500).json({ error: companyError.message });
    }
  }

  // 4) Update / upsert provider_profile
  if (providerProfile) {
    const {
      displayName,
      bio,
      baseCity,
      postalCode,
      hasMobileService,
      hasGarage,
      minPrice,
      services,
      transportPricePerKm,
      transportEnabled,
      serviceArea, // ✅ Zone d'intervention (JSON)
      welcomingOfferEnabled,
    } = providerProfile;

    const providerUpdate = {
      user_id: userId,
      display_name: displayName,
      bio,
      base_city: baseCity,
      postal_code: postalCode,
      has_mobile_service: hasMobileService,
      has_garage: hasGarage,
      min_price: minPrice,
      // rating : calculé côté système → on ne le touche pas ici
      services,
      transport_price_per_km: transportPricePerKm,
      transport_enabled: transportEnabled,
      service_area: serviceArea, // ✅ Zone d'intervention (JSON)
    };
    
    // Ajouter welcoming_offer_enabled seulement si défini
    if (welcomingOfferEnabled !== undefined) {
      providerUpdate.welcoming_offer_enabled = welcomingOfferEnabled;
    }

    const { error: providerError } = await supabaseAdmin
      .from("provider_profiles")
      .upsert(providerUpdate, { onConflict: "user_id" });

    if (providerError) {
      return res.status(500).json({ error: providerError.message });
    }
  }

  // 5) Renvoi le profil à jour
  return await getProfile(req, res);
}

// ========= EXPORT PROFILE (RGPD – télécharger mes données) =========
// Même logique que getProfile : requêtes séparées + limit(1) pour éviter "Cannot coerce"
export async function exportProfileData(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const { data: userRow, error: userError } = await supabaseAdmin
      .from("users")
      .select(`
        id, email, phone, role, vat_number, is_vat_valid,
        referral_code, referred_by, customer_credits_eur,
        welcoming_offer_used, dismissed_first_booking_offer,
        created_at, updated_at
      `)
      .eq("id", userId)
      .maybeSingle();
    if (userError) return res.status(500).json({ error: userError.message });
    if (!userRow) return res.status(404).json({ error: "Profile not found" });

    const [customerRes, companyRes, providerRes] = await Promise.all([
      supabaseAdmin.from("customer_profiles").select("first_name, last_name, default_address, preferred_city_id, vehicle_type, service_at_home, home_water, home_electricity, home_space, avatar_url").eq("user_id", userId).limit(1),
      supabaseAdmin.from("company_profiles").select("legal_name, company_type_id, city, postal_code, contact_name, logo_url, commercial_name, bce_number, country, registered_address, legal_representative_name, languages_spoken, currency, sector, fleet_size, main_address, mission_zones, place_types, is_verified, payment_success_rate, late_cancellations_count, open_disputes_count, closed_disputes_count, missions_posted_count, missions_completed_count, detailer_satisfaction_rate, detailer_rating").eq("user_id", userId).limit(1),
      supabaseAdmin.from("provider_profiles").select("display_name, bio, base_city, postal_code, has_mobile_service, has_garage, min_price, rating, services, company_name, lat, lng, review_count, team_size, years_of_experience, logo_url, banner_url, transport_price_per_km, transport_enabled, welcoming_offer_enabled, opening_hours, available_today").eq("user_id", userId).limit(1),
    ]);

    const data = {
      ...userRow,
      customer_profiles: customerRes.data?.length ? [customerRes.data[0]] : [],
      company_profiles: companyRes.data?.length ? [companyRes.data[0]] : [],
      provider_profiles: providerRes.data?.length ? [providerRes.data[0]] : [],
    };
    const userDto = mapUserRowToDto(data);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "attachment; filename=\"nios-my-data.json\"");
    res.setHeader("Cache-Control", "no-store");
    return res.json({ user: userDto, exportedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[PROFILE] export error:", err);
    return res.status(500).json({ error: "Could not export data" });
  }
}

// ========= DELETE ACCOUNT (RGPD – droit à l'oubli) =========
export async function deleteAccount(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: "Password required to delete account" });
  }
  try {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: req.user.email,
      password,
    });
    if (signInError) {
      return res.status(401).json({ error: "Invalid password" });
    }
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("[PROFILE] deleteUser error:", deleteError);
      return res.status(500).json({ error: "Could not delete account" });
    }
    return res.json({ success: true, message: "Account deleted" });
  } catch (err) {
    console.error("[PROFILE] deleteAccount error:", err);
    return res.status(500).json({ error: "Could not delete account" });
  }
}
