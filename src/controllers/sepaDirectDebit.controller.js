// src/controllers/sepaDirectDebit.controller.js
import {
  createSepaSetupIntent,
  getSepaMandate,
  listSepaPaymentMethods,
  deleteSepaPaymentMethod,
  createSepaPaymentIntent,
  captureSepaPayment,
  cancelSepaPayment,
} from "../services/sepaDirectDebit.service.js";

/**
 * 🔹 POST /api/v1/sepa/setup-intent
 * Créer un Setup Intent pour configurer SEPA Direct Debit
 */
export async function createSepaSetupIntentController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can set up SEPA Direct Debit" });
    }

    const result = await createSepaSetupIntent(req.user.id);

    return res.json({ data: result });
  } catch (err) {
    console.error("[SEPA] setup intent error:", err);
    return res.status(500).json({ error: err.message || "Could not create SEPA setup intent" });
  }
}

/**
 * 🔹 GET /api/v1/sepa/mandate
 * Récupérer le mandate SEPA actif de la company
 * 
 * Selon la documentation Stripe :
 * - Un mandate SEPA est créé automatiquement lors de la confirmation d'un SetupIntent
 * - Le statut peut être : "active", "inactive", ou "pending"
 * - Seul un mandate "active" permet d'effectuer des prélèvements SEPA
 */
export async function getSepaMandateController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can view SEPA mandates" });
    }

    const mandate = await getSepaMandate(req.user.id);

    if (!mandate) {
      return res.status(404).json({ 
        error: "No active SEPA mandate found. Please set up SEPA Direct Debit first.",
        code: "SEPA_MANDATE_MISSING"
      });
    }

    // Retourner le mandate avec des informations supplémentaires
    return res.json({ 
      data: {
        ...mandate,
        // Informations additionnelles pour l'UI
        isActive: mandate.status === "active",
        canUseForPayments: mandate.status === "active",
      }
    });
  } catch (err) {
    console.error("[SEPA] get mandate error:", err);
    return res.status(500).json({ 
      error: "Could not fetch SEPA mandate",
      code: "SEPA_MANDATE_FETCH_ERROR"
    });
  }
}

/**
 * 🔹 GET /api/v1/sepa/payment-methods
 * Lister les moyens de paiement SEPA de la company
 */
export async function listSepaPaymentMethodsController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can view SEPA payment methods" });
    }

    const paymentMethods = await listSepaPaymentMethods(req.user.id);

    return res.json({ data: paymentMethods });
  } catch (err) {
    console.error("[SEPA] list payment methods error:", err);
    return res.status(500).json({ error: "Could not fetch SEPA payment methods" });
  }
}

/**
 * 🔹 DELETE /api/v1/sepa/payment-methods/:id
 * Supprimer un moyen de paiement SEPA
 */
export async function deleteSepaPaymentMethodController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can delete SEPA payment methods" });
    }

    const { id } = req.params;
    await deleteSepaPaymentMethod(req.user.id, id);

    return res.json({ success: true });
  } catch (err) {
    console.error("[SEPA] delete payment method error:", err);
    return res.status(400).json({ error: err.message || "Could not delete SEPA payment method" });
  }
}

/**
 * 🔹 POST /api/v1/sepa/payment-intent
 * Créer un Payment Intent avec SEPA Direct Debit
 */
export async function createSepaPaymentIntentController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can create SEPA payment intents" });
    }

    const { amount, currency, paymentMethodId, metadata } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const paymentIntent = await createSepaPaymentIntent({
      companyUserId: req.user.id,
      amount,
      currency: currency || "eur",
      paymentMethodId: paymentMethodId || null,
      metadata: metadata || {},
    });

    return res.json({ data: paymentIntent });
  } catch (err) {
    console.error("[SEPA] payment intent error:", err);
    return res.status(400).json({ error: err.message || "Could not create SEPA payment intent" });
  }
}

/**
 * 🔹 POST /api/v1/sepa/capture
 * Capturer un paiement SEPA pré-autorisé
 */
export async function captureSepaPaymentController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can capture SEPA payments" });
    }

    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: "Missing paymentIntentId" });
    }

    const result = await captureSepaPayment(paymentIntentId);

    return res.json({ data: result });
  } catch (err) {
    console.error("[SEPA] capture error:", err);
    return res.status(400).json({ error: err.message || "Could not capture SEPA payment" });
  }
}

/**
 * 🔹 POST /api/v1/sepa/cancel
 * Annuler un paiement SEPA pré-autorisé
 */
export async function cancelSepaPaymentController(req, res) {
  try {
    if (req.user.role !== "company") {
      return res.status(403).json({ error: "Only companies can cancel SEPA payments" });
    }

    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: "Missing paymentIntentId" });
    }

    const result = await cancelSepaPayment(paymentIntentId);

    return res.json({ data: result });
  } catch (err) {
    console.error("[SEPA] cancel error:", err);
    return res.status(400).json({ error: err.message || "Could not cancel SEPA payment" });
  }
}
