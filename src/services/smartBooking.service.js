// src/services/smartBooking.service.js
import { getAllProviders } from "./provider.service.js";
import { getAvailableSlotsForDate } from "./providerAvailability.service.js";

/** Rayons successifs (km) pour élargir la recherche jusqu'à trouver des détaileurs */
const EXPANDING_RADII_KM = [5, 10, 15, 20, 25, 50, 100];

function degreesToRadians(deg) {
  return (deg * Math.PI) / 180;
}

/** Distance en km (Haversine) */
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = degreesToRadians(lat2 - lat1);
  const dLng = degreesToRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(degreesToRadians(lat1)) *
      Math.cos(degreesToRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Frais de transport par zone (aligné avec booking.controller) */
function transportFeeByZone(distanceKm) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  if (distanceKm > 25) return 20;
  if (distanceKm > 10) return 15;
  return 0;
}

/**
 * Smart Booking : recherche de détaileurs en élargissant le rayon jusqu'à en trouver.
 * - Garage : filtre has_garage, tri par distance.
 * - Mobile : filtre has_mobile_service, tri par frais de transport puis distance.
 * @param {Object} params
 * @param {number} params.customerLat
 * @param {number} params.customerLng
 * @param {string} params.date YYYY-MM-DD
 * @param {string} [params.preferredHour] "HH:mm" ou "any"
 * @param {string} params.serviceAtProvider "garage" | "mobile"
 * @param {number} [params.durationMinutes] 60 par défaut
 * @returns {Promise<Array>} Liste de détaileurs avec distanceKm et transportFee (mobile)
 */
export async function getSmartBookingProviders(params) {
  const {
    customerLat,
    customerLng,
    date,
    preferredHour,
    serviceAtProvider,
    durationMinutes = 60,
  } = params;

  if (customerLat == null || customerLng == null) {
    return [];
  }

  const isMobile = String(serviceAtProvider).toLowerCase() === "mobile";
  const duration = Math.max(15, Number(durationMinutes) || 60);
  const checkAvailability =
    date && preferredHour && preferredHour !== "any";

  let collected = [];

  for (const radiusKm of EXPANDING_RADII_KM) {
    const providers = await getAllProviders({
      lat: customerLat,
      lng: customerLng,
      radius: radiusKm,
    });

    let filtered = providers;
    if (isMobile) {
      filtered = providers.filter((p) => p.hasMobileService === true);
    } else {
      filtered = providers.filter((p) => p.hasGarage === true);
    }

    if (checkAvailability && filtered.length > 0) {
      const withSlots = await Promise.all(
        filtered.map(async (p) => {
          const slots = await getAvailableSlotsForDate(p.id, date, duration);
          return { provider: p, slots };
        })
      );
      filtered = withSlots
        .filter(({ slots }) => slots.includes(preferredHour))
        .map(({ provider }) => provider);
    }

    if (filtered.length > 0) {
      collected = filtered;
      break;
    }
  }

  const lat0 = Number(customerLat);
  const lng0 = Number(customerLng);

  const withMeta = collected.map((p) => {
    const dist = distanceKm(lat0, lng0, p.lat ?? 0, p.lng ?? 0);
    const transportFee = isMobile ? transportFeeByZone(dist) : 0;
    return {
      ...p,
      distanceKm: Math.round(dist * 100) / 100,
      transportFee: isMobile ? transportFee : undefined,
    };
  });

  if (isMobile) {
    withMeta.sort((a, b) => {
      const feeA = a.transportFee ?? 0;
      const feeB = b.transportFee ?? 0;
      if (feeA !== feeB) return feeA - feeB;
      return (a.distanceKm ?? 0) - (b.distanceKm ?? 0);
    });
  } else {
    withMeta.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  }

  return withMeta;
}
