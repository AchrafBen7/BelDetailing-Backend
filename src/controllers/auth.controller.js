// src/controllers/auth.controller.js
import { supabase } from "../config/supabase.js";

// Petit helper pour mapper la ligne SQL → modèle iOS User
function mapUserRowToDto(row) {
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    role: row.role,
    vatNumber: row.vat_number,
    isVatValid: row.is_vat_valid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    customerProfile: row.customer_profiles?.length
      ? {
          firstName: row.customer_profiles[0].first_name,
          lastName: row.customer_profiles[0].last_name,
          defaultAddress: row.customer_profiles[0].default_address,
          preferredCityId: row.customer_profiles[0].preferred_city_id,
        }
      : null,

    companyProfile: row.company_profiles?.length
      ? {
          legalName: row.company_profiles[0].legal_name,
          companyTypeId: row.company_profiles[0].company_type_id,
          city: row.company_profiles[0].city,
          postalCode: row.company_profiles[0].postal_code,
          contactName: row.company_profiles[0].contact_name,
          logoUrl: row.company_profiles[0].logo_url,
        }
      : null,

    providerProfile: row.provider_profiles?.length
      ? {
          displayName: row.provider_profiles[0].display_name,
          bio: row.provider_profiles[0].bio,
          baseCity: row.provider_profiles[0].base_city,
          postalCode: row.provider_profiles[0].postal_code,
          hasMobileService: row.provider_profiles[0].has_mobile_service,
          minPrice: row.provider_profiles[0].min_price,
          rating: row.provider_profiles[0].rating,
          services: row.provider_profiles[0].services,
        }
      : null,
  };
}

// ========= REGISTER =========
export async function register(req, res) {
  const { email, password, role, phone } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Missing email or password" });
  }

  // 1) création Supabase Auth user
  const { data: signUpData, error: signUpError } =
    await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: role || "customer",
          phone: phone || "",
        },
      },
    });

  if (signUpError) {
    return res.status(400).json({ error: signUpError.message });
  }

  const authUser = signUpData.user;
  if (!authUser) {
    return res.status(500).json({ error: "No user returned from Supabase" });
  }

  // 2) ligne dans table public.users
  const { error: insertError } = await supabase.from("users").insert({
    id: authUser.id,
    email: authUser.email,
    phone: phone || "",
    role: role || "customer",
  });

  if (insertError) {
    // rollback soft possible (pas obligatoire pour MVP)
    return res.status(500).json({ error: insertError.message });
  }

  return res.status(201).json({
    user: {
      id: authUser.id,
      email: authUser.email,
      role: role || "customer",
    },
  });
}

// ========= LOGIN =========
export async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Missing email or password" });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    if (error.message.includes("Email not confirmed")) {
      return res.status(401).json({ error: "Email not confirmed" });
    }
    return res.status(401).json({ error: error.message });
  }

  const { session, user } = data;

  // On récupère aussi user app (role + phone) depuis table users
  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (userError) {
    return res.status(500).json({ error: userError.message });
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      role: userRow.role,
      phone: userRow.phone,
      vatNumber: userRow.vat_number,
      isVatValid: userRow.is_vat_valid,
    },
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    tokenType: session.token_type,
    expiresIn: session.expires_in,
  });
}

// ========= REFRESH =========
export async function refreshToken(req, res) {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: "Missing refreshToken" });
  }

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error) {
    return res.status(401).json({ error: error.message });
  }

  const { session, user } = data;

  // On relit notre user app
  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (userError) {
    return res.status(500).json({ error: userError.message });
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      role: userRow.role,
      phone: userRow.phone,
      vatNumber: userRow.vat_number,
      isVatValid: userRow.is_vat_valid,
    },
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    tokenType: session.token_type,
    expiresIn: session.expires_in,
  });
}

// ========= GET PROFILE =========
export async function getProfile(req, res) {
  // req.user vient du middleware requireAuth (JWT Supabase)
  const userId = req.user?.sub;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { data, error } = await supabase
    .from("users")
    .select(
      `
      id, email, phone, role, vat_number, is_vat_valid,
      created_at, updated_at,
      customer_profiles ( first_name, last_name, default_address, preferred_city_id ),
      company_profiles  ( legal_name, company_type_id, city, postal_code, contact_name, logo_url ),
      provider_profiles ( display_name, bio, base_city, postal_code, has_mobile_service, min_price, rating, services )
    `
    )
    .eq("id", userId)
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const userDto = mapUserRowToDto(data);
  return res.json({ user: userDto });
}

// ========= UPDATE PROFILE =========
export async function updateProfile(req, res) {
  const userId = req.user?.sub;
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
    } = providerProfile;

    const { error: providerError } = await supabase
      .from("provider_profiles")
      .upsert(
        {
          user_id: userId,
          display_name: displayName,
          bio,
          base_city: baseCity,
          postal_code: postalCode,
          has_mobile_service: hasMobileService,
          min_price: minPrice,
          // rating : calculé côté système → on ne le touche pas ici
          services,
        },
        { onConflict: "user_id" }
      );

    if (providerError) {
      return res.status(500).json({ error: providerError.message });
    }
  }

  // 5) Renvoi le profil à jour
  return await getProfile(req, res);
}
