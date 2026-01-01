// src/services/vat.service.js
export async function validateVATNumber(vatNumber) {
  const normalized = String(vatNumber || "").trim();
  if (normalized.length < 3) {
    return {
      valid: false,
      country: null,
      number: null,
      name: null,
    };
  }

  const countryCode = normalized.substring(0, 2).toUpperCase();
  const number = normalized.substring(2);

  try {
    const response = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${number}`
    );

    if (!response.ok) {
      return { valid: false, country: countryCode, number, name: null };
    }

    const payload = await response.json();
    return {
      valid: Boolean(payload.valid),
      country: countryCode,
      number,
      name: payload.name || null,
    };
  } catch (err) {
    return {
      valid: false,
      country: countryCode,
      number,
      name: null,
    };
  }
}
