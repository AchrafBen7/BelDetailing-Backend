// src/config/commission.js
/**
 * Configuration des taux de commission NIOS
 */

// Commission pour les bookings (services classiques)
export const BOOKING_COMMISSION_RATE = 0.10; // 10%

// Commission pour les missions (offers)
export const MISSION_COMMISSION_RATE = 0.07; // 7%

/**
 * Obtenir le taux de commission selon le type de transaction
 * @param {string} type - "booking" ou "mission"
 * @returns {number} Taux de commission (0.10 ou 0.07)
 */
export function getCommissionRate(type) {
  switch (type) {
    case "booking":
      return BOOKING_COMMISSION_RATE;
    case "mission":
      return MISSION_COMMISSION_RATE;
    default:
      return MISSION_COMMISSION_RATE; // Par défaut, missions
  }
}
