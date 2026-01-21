// src/services/peppol.service.js
// Service pour l'intégration Peppol via Billit API

import axios from "axios";

const BILLIT_API_BASE_URL = process.env.BILLIT_API_BASE_URL || "https://api.billit.be/v1";
// Charger dotenv si pas déjà chargé
import dotenv from "dotenv";
dotenv.config();

const BILLIT_API_KEY = process.env.BILLIT_API_KEY;

if (!BILLIT_API_KEY) {
  // Log seulement si vraiment utilisé, pas au chargement du module
  // console.warn("⚠️ BILLIT_API_KEY not set - Peppol invoices will not be sent");
}

/**
 * Configuration NIOS pour les factures Peppol
 */
const NIOS_COMPANY_INFO = {
  name: process.env.NIOS_COMPANY_NAME || "ISOBEN SRL",
  vat: process.env.NIOS_VAT_NUMBER || "", // À configurer
  address: process.env.NIOS_ADDRESS || "", // À configurer
  city: process.env.NIOS_CITY || "",
  postalCode: process.env.NIOS_POSTAL_CODE || "",
  country: "BE",
  iban: process.env.NIOS_IBAN || "", // À configurer
  peppolId: process.env.NIOS_PEPPOL_ID || "", // À configurer
};

/**
 * Valide un numéro TVA belge via VIES (optionnel, peut être fait côté frontend)
 */
export async function validateVATNumber(vatNumber) {
  if (!vatNumber || !vatNumber.startsWith("BE")) {
    return { valid: false, error: "Invalid VAT format (must start with BE)" };
  }

  // Format BE: BE0123456789 (11 caractères)
  const cleaned = vatNumber.replace(/\s/g, "").toUpperCase();
  if (!/^BE\d{10}$/.test(cleaned)) {
    return { valid: false, error: "Invalid VAT format (BE + 10 digits)" };
  }

  // TODO: Appel API VIES si nécessaire (peut être fait côté frontend)
  // Pour l'instant, on valide juste le format
  return { valid: true, cleaned };
}

/**
 * Crée une facture Peppol via Billit API
 * @param {Object} booking - Booking complet avec infos Peppol
 * @param {Object} provider - Provider profile
 * @returns {Promise<{success: boolean, invoiceId?: string, error?: string}>}
 */
export async function sendPeppolInvoice(booking, provider) {
  if (!BILLIT_API_KEY) {
    console.error("❌ [PEPPOL] BILLIT_API_KEY not configured");
    return { success: false, error: "Peppol service not configured" };
  }

  if (!booking.peppol_requested) {
    return { success: false, error: "Peppol not requested for this booking" };
  }

  if (!booking.company_name || !booking.company_vat) {
    return { success: false, error: "Missing company information" };
  }

  try {
    // 1) Calculer les montants
    const totalPrice = Number(booking.price) || 0;
    const vatRate = 0.21; // TVA 21% Belgique
    const priceExclVat = totalPrice / (1 + vatRate);
    const vatAmount = totalPrice - priceExclVat;

    // 2) Construire la facture selon le format Billit
    const invoiceData = {
      // Informations émetteur (NIOS)
      issuer: {
        name: NIOS_COMPANY_INFO.name,
        vatNumber: NIOS_COMPANY_INFO.vat,
        address: {
          street: NIOS_COMPANY_INFO.address,
          city: NIOS_COMPANY_INFO.city,
          postalCode: NIOS_COMPANY_INFO.postalCode,
          country: NIOS_COMPANY_INFO.country,
        },
        iban: NIOS_COMPANY_INFO.iban,
        peppolId: NIOS_COMPANY_INFO.peppolId,
      },

      // Informations client (entreprise)
      customer: {
        name: booking.company_name,
        vatNumber: booking.company_vat,
        address: booking.company_address || "",
        peppolId: booking.company_peppol_id || null,
      },

      // Informations facture
      invoice: {
        number: `NIOS-INV-${new Date().getFullYear()}-${String(booking.id).slice(-6).padStart(6, "0")}`,
        date: new Date().toISOString().split("T")[0], // Date du jour
        serviceDate: booking.date, // Date du service
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // +30 jours
        reference: `Booking ${booking.id}`,
        currency: booking.currency?.toUpperCase() || "EUR",
      },

      // Lignes de facture
      lines: [
        {
          description: `${booking.service_name || "Service"} - Réalisé par ${provider.display_name || booking.provider_name}`,
          quantity: 1,
          unitPrice: priceExclVat,
          vatRate: vatRate * 100, // 21%
          totalExclVat: priceExclVat,
          vatAmount: vatAmount,
          totalInclVat: totalPrice,
        },
      ],

      // Totaux
      totals: {
        subtotalExclVat: priceExclVat,
        totalVat: vatAmount,
        totalInclVat: totalPrice,
      },

      // Métadonnées
      metadata: {
        bookingId: booking.id,
        providerId: booking.provider_id,
        providerName: booking.provider_name,
        serviceName: booking.service_name,
        paymentMethod: booking.payment_method || "card",
        paymentStatus: booking.payment_status,
      },

      // Footer
      footer: {
        note: "Paiement effectué via NIOS. Commission incluse.",
        support: "support@nios.be",
      },
    };

    // 3) Appel API Billit
    const response = await axios.post(
      `${BILLIT_API_BASE_URL}/invoices/peppol`,
      invoiceData,
      {
        headers: {
          "Authorization": `Bearer ${BILLIT_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000, // 30 secondes
      }
    );

    if (response.status === 200 || response.status === 201) {
      const invoiceId = response.data.invoiceId || response.data.id;
      console.log(`✅ [PEPPOL] Invoice sent successfully: ${invoiceId}`);
      return { success: true, invoiceId };
    } else {
      console.error(`❌ [PEPPOL] Unexpected status: ${response.status}`);
      return { success: false, error: `Unexpected status: ${response.status}` };
    }
  } catch (error) {
    console.error("❌ [PEPPOL] Error sending invoice:", error.message);
    
    if (error.response) {
      // Erreur API Billit
      const status = error.response.status;
      const message = error.response.data?.message || error.response.data?.error || "Unknown error";
      console.error(`❌ [PEPPOL] Billit API error (${status}):`, message);
      return { success: false, error: `Billit API error: ${message}` };
    } else if (error.request) {
      // Pas de réponse
      console.error("❌ [PEPPOL] No response from Billit API");
      return { success: false, error: "No response from Peppol service" };
    } else {
      // Erreur de configuration
      return { success: false, error: error.message };
    }
  }
}

/**
 * Vérifie le statut d'une facture Peppol
 */
export async function checkPeppolInvoiceStatus(invoiceId) {
  if (!BILLIT_API_KEY || !invoiceId) {
    return { success: false, error: "Missing configuration or invoice ID" };
  }

  try {
    const response = await axios.get(
      `${BILLIT_API_BASE_URL}/invoices/${invoiceId}/status`,
      {
        headers: {
          "Authorization": `Bearer ${BILLIT_API_KEY}`,
        },
        timeout: 10000,
      }
    );

    return { success: true, status: response.data.status };
  } catch (error) {
    console.error("❌ [PEPPOL] Error checking invoice status:", error.message);
    return { success: false, error: error.message };
  }
}
