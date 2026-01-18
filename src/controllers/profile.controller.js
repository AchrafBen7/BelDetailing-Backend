
import { mapUserRowToDto } from "../mappers/user.mapper.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";


// ========= GET PROFILE =========
export async function getProfile(req, res) {
  // req.user vient du middleware requireAuth (JWT Supabase)
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { data, error } = await supabase
  .from("users")
  .select(`
    id,
    email,
    phone,
    role,
    vat_number,
    is_vat_valid,
    welcoming_offer_used,
    dismissed_first_booking_offer,
    created_at,
    updated_at,
    customer_profiles (
      first_name,
      last_name,
      default_address,
      preferred_city_id,
      vehicle_type
    ),
    company_profiles (
      legal_name,
      company_type_id,
      city,
      postal_code,
      contact_name,
      logo_url
    ),
    provider_profiles (
      display_name,
      bio,
      base_city,
      postal_code,
      has_mobile_service,
      min_price,
      rating,
      services,
      company_name,
      lat,
      lng,
      review_count,
      team_size,
      years_of_experience,
      logo_url,
      banner_url,
      transport_price_per_km,
      transport_enabled,
      welcoming_offer_enabled
    )
  `)
  .eq("id", userId)
  .single();


  if (error) {
    return res.status(500).json({ error: error.message });
  }

try {
  const userDto = mapUserRowToDto(data);
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

  const {
    phone,
    role,
    vatNumber,
    isVatValid,
    customerProfile,
    companyProfile,
    providerProfile,
  } = req.body;

  // 1) Update table users
  const userUpdate = {};
  if (phone !== undefined) userUpdate.phone = phone;
  if (role !== undefined) userUpdate.role = role;
  if (vatNumber !== undefined) userUpdate.vat_number = vatNumber;
  if (isVatValid !== undefined) userUpdate.is_vat_valid = isVatValid;

  if (Object.keys(userUpdate).length > 0) {
    const { error: userError } = await supabase
      .from("users")
      .update(userUpdate)
      .eq("id", userId);

    if (userError) {
      return res.status(500).json({ error: userError.message });
    }
  }

  // 2) Update / upsert customer_profile
  if (customerProfile) {
    const {
      firstName,
      lastName,
      defaultAddress,
      preferredCityId,
      vehicleType,
    } = customerProfile;

    const { error: customerError } = await supabase
      .from("customer_profiles")
      .upsert(
        {
          user_id: userId,
          first_name: firstName,
          last_name: lastName,
          default_address: defaultAddress,
          preferred_city_id: preferredCityId,
          vehicle_type: vehicleType,
        },
        { onConflict: "user_id" }
      );

    if (customerError) {
      return res.status(500).json({ error: customerError.message });
    }
  }

  // 3) Update / upsert company_profile
  if (companyProfile) {
    const {
      legalName,
      companyTypeId,
      city,
      postalCode,
      contactName,
      logoUrl,
    } = companyProfile;

    const { error: companyError } = await supabase
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

    const { error: providerError } = await supabase
      .from("provider_profiles")
      .upsert(providerUpdate, { onConflict: "user_id" });

    if (providerError) {
      return res.status(500).json({ error: providerError.message });
    }
  }

  // 5) Renvoi le profil à jour
  return await getProfile(req, res);
}
