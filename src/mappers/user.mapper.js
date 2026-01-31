// ===========================
// CLEAN NULL HELPER
// ===========================
function cleanNull(v) {
  if (v === null || v === undefined || v === "<null>" || v === "null") return null;
  return v;
}

// ===========================
// USER MAPPER
// ===========================
export function mapUserRowToDto(row) {
  if (!row) return null;

  // Relations Supabase (toujours tableau)
  const c = Array.isArray(row.customer_profiles) ? row.customer_profiles[0] : null;
  const co = Array.isArray(row.company_profiles) ? row.company_profiles[0] : null;
  const p = Array.isArray(row.provider_profiles) ? row.provider_profiles[0] : null;

  return {
    id: cleanNull(row.id),
    email: cleanNull(row.email),
    phone: cleanNull(row.phone),
    role: cleanNull(row.role),

    vatNumber: cleanNull(row.vat_number),
    isVatValid: cleanNull(row.is_vat_valid),
    
    welcomingOfferUsed: row.welcoming_offer_used ?? false, // ✅ Offre de bienvenue utilisée
    dismissedFirstBookingOffer: row.dismissed_first_booking_offer ?? false, // ✅ Offre de bienvenue fermée définitivement

    createdAt: cleanNull(row.created_at),
    updatedAt: cleanNull(row.updated_at),

    // ===========================
    // CUSTOMER PROFILE
    // ===========================
    customerProfile: c
      ? {
          firstName: cleanNull(c.first_name),
          lastName: cleanNull(c.last_name),
          defaultAddress: cleanNull(c.default_address),
          preferredCityId: cleanNull(c.preferred_city_id),
          vehicleType: cleanNull(c.vehicle_type),
        }
      : null,

    // ===========================
    // COMPANY PROFILE (identité légale, confiance, fiabilité)
    // ===========================
    companyProfile: co
      ? {
          legalName: cleanNull(co.legal_name),
          companyTypeId: cleanNull(co.company_type_id),
          city: cleanNull(co.city),
          postalCode: cleanNull(co.postal_code),
          contactName: cleanNull(co.contact_name),
          logoUrl: cleanNull(co.logo_url),
          commercialName: cleanNull(co.commercial_name),
          bceNumber: cleanNull(co.bce_number),
          country: cleanNull(co.country),
          registeredAddress: cleanNull(co.registered_address),
          legalRepresentativeName: cleanNull(co.legal_representative_name),
          languagesSpoken: cleanNull(co.languages_spoken),
          currency: cleanNull(co.currency),
          sector: cleanNull(co.sector),
          fleetSize: cleanNull(co.fleet_size),
          mainAddress: cleanNull(co.main_address),
          missionZones: cleanNull(co.mission_zones),
          placeTypes: cleanNull(co.place_types),
          isVerified: co.is_verified ?? false,
          paymentSuccessRate: co.payment_success_rate != null ? Number(co.payment_success_rate) : null,
          lateCancellationsCount: co.late_cancellations_count ?? null,
          openDisputesCount: co.open_disputes_count ?? null,
          closedDisputesCount: co.closed_disputes_count ?? null,
          missionsPostedCount: co.missions_posted_count ?? null,
          missionsCompletedCount: co.missions_completed_count ?? null,
          detailerSatisfactionRate: co.detailer_satisfaction_rate != null ? Number(co.detailer_satisfaction_rate) : null,
          detailerRating: co.detailer_rating != null ? Number(co.detailer_rating) : null,
        }
      : null,

    // ===========================
    // PROVIDER PROFILE
    // ===========================
    providerProfile: p
      ? {
          displayName: cleanNull(p.display_name),
          bio: cleanNull(p.bio),
          baseCity: cleanNull(p.base_city),
          postalCode: cleanNull(p.postal_code),
          hasMobileService: p.has_mobile_service ?? false,

          minPrice: cleanNull(p.min_price),
          rating: cleanNull(p.rating),
          services: Array.isArray(p.services) ? p.services : [],

          companyName: cleanNull(p.company_name),
          lat: cleanNull(p.lat),
          lng: cleanNull(p.lng),
          reviewCount: cleanNull(p.review_count),
          teamSize: cleanNull(p.team_size),
          yearsOfExperience: cleanNull(p.years_of_experience),
          logoUrl: cleanNull(p.logo_url),
          bannerUrl: cleanNull(p.banner_url),
          transportPricePerKm: cleanNull(p.transport_price_per_km),
          transportEnabled: p.transport_enabled ?? false,
          serviceArea: p.service_area ?? null, // ✅ Zone d'intervention (JSON)
          welcomingOfferEnabled: p.welcoming_offer_enabled ?? false, // ✅ Offre de bienvenue
        }
      : null,
  };
}
