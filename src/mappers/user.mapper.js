export function mapUserRowToDto(row) {
  if (!row) return null;

  // Les relations Supabase reviennent en tableau
  const c = Array.isArray(row.customer_profiles) ? row.customer_profiles[0] : null;
  const co = Array.isArray(row.company_profiles) ? row.company_profiles[0] : null;
  const p = Array.isArray(row.provider_profiles) ? row.provider_profiles[0] : null;

  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    role: row.role,
    vatNumber: row.vat_number,
    isVatValid: row.is_vat_valid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    customerProfile: c
      ? {
          firstName: c.first_name ?? null,
          lastName: c.last_name ?? null,
          defaultAddress: c.default_address ?? null,
          preferredCityId: c.preferred_city_id ?? null,
        }
      : null,

    companyProfile: co
      ? {
          legalName: co.legal_name ?? null,
          companyTypeId: co.company_type_id ?? null,
          city: co.city ?? null,
          postalCode: co.postal_code ?? null,
          contactName: co.contact_name ?? null,
          logoUrl: co.logo_url ?? null,
        }
      : null,

    providerProfile: p
      ? {
          displayName: p.display_name ?? null,
          bio: p.bio ?? null,
          baseCity: p.base_city ?? null,
          postalCode: p.postal_code ?? null,
          hasMobileService: p.has_mobile_service ?? false,
          minPrice: p.min_price ?? null,
          rating: p.rating ?? null,
          services: p.services ?? [],
          companyName: p.company_name ?? null,
          lat: p.lat ?? null,
          lng: p.lng ?? null,
          reviewCount: p.review_count ?? null,
          teamSize: p.team_size ?? null,
          yearsOfExperience: p.years_of_experience ?? null,
          logoUrl: p.logo_url ?? null,
          bannerUrl: p.banner_url ?? null,
        }
      : null,
  };
}
