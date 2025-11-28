export function mapUserRowToDto(row) {
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

    customerProfile: row.customer_profiles
      ? {
          firstName: row.customer_profiles.first_name,
          lastName: row.customer_profiles.last_name,
          defaultAddress: row.customer_profiles.default_address,
          preferredCityId: row.customer_profiles.preferred_city_id,
        }
      : null,

    companyProfile: row.company_profiles
      ? {
          legalName: row.company_profiles.legal_name,
          companyTypeId: row.company_profiles.company_type_id,
          city: row.company_profiles.city,
          postalCode: row.company_profiles.postal_code,
          contactName: row.company_profiles.contact_name,
          logoUrl: row.company_profiles.logo_url,
        }
      : null,

    providerProfile: row.provider_profiles
      ? {
          displayName: row.provider_profiles.display_name,
          bio: row.provider_profiles.bio,
          baseCity: row.provider_profiles.base_city,
          postalCode: row.provider_profiles.postal_code,
          hasMobileService: row.provider_profiles.has_mobile_service,
          minPrice: row.provider_profiles.min_price,
          rating: row.provider_profiles.rating,
          services: row.provider_profiles.services,
          companyName: row.provider_profiles.company_name,
          lat: row.provider_profiles.lat,
          lng: row.provider_profiles.lng,
          reviewCount: row.provider_profiles.review_count,
          teamSize: row.provider_profiles.team_size,
          yearsOfExperience: row.provider_profiles.years_of_experience,
          logoUrl: row.provider_profiles.logo_url,
          bannerUrl: row.provider_profiles.banner_url,
        }
      : null,
  };
}
