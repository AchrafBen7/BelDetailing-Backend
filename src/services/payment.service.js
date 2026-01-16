// src/services/payment.service.js
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

/* -----------------------------------------------------
   CREATE PAYMENT INTENT — Préautorisation standard
----------------------------------------------------- */
export async function createPaymentIntent({ amount, currency, user }) {
  const customerId = await getOrCreateStripeCustomer(user);

  const stripeIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency,
    customer: customerId, // ✅ LIGNE CRUCIALE
    capture_method: "manual",
    // ✅ Utiliser automatic_payment_methods pour permettre Apple Pay natif
    automatic_payment_methods: {
      enabled: true,
    },
    metadata: {
      userId: user.id,
      source: "beldetailing-app",
      type: "booking",
    },
  });

  return {
    id: stripeIntent.id,
    clientSecret: stripeIntent.client_secret,
    amount,
    currency,
    status: stripeIntent.status,
  };
}

/* -----------------------------------------------------
   CREATE PAYMENT INTENT — Orders (paiement direct)
----------------------------------------------------- */
export async function createPaymentIntentForOrder({
  amount,
  currency,
  user,
  orderId,
}) {
  const customerId = await getOrCreateStripeCustomer(user);

  const stripeIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency,
    customer: customerId,
    // ✅ Utiliser automatic_payment_methods pour permettre Apple Pay natif
    automatic_payment_methods: {
      enabled: true,
    },
    metadata: {
      userId: user.id,
      source: "beldetailing-app",
      type: "order",
      orderId,
    },
  });

  return {
    id: stripeIntent.id,
    clientSecret: stripeIntent.client_secret,
    amount,
    currency,
    status: stripeIntent.status,
  };
}


/* -----------------------------------------------------
   CAPTURE PAYMENT — Provider accepte
----------------------------------------------------- */
export async function capturePayment(paymentIntentId) {
  try {
    const captured = await stripe.paymentIntents.capture(paymentIntentId);
    return captured.status === "succeeded";
  } catch (err) {
    console.error("[STRIPE ERROR - capturePayment]", err);
    return false;
  }
}

/* -----------------------------------------------------
   REFUND PAYMENT — Provider refuse / auto-cancel
----------------------------------------------------- */
export async function refundPayment(paymentIntentId, amount) {
  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount != null ? Math.round(amount * 100) : undefined,
    });

    return refund.status === "succeeded";
  } catch (err) {
    console.error("[STRIPE ERROR - refundPayment]", err);
    return false;
  }
}

/* -----------------------------------------------------
   STRIPE CUSTOMER HELPERS
----------------------------------------------------- */
async function getOrCreateStripeCustomer(user) {
  if (user.stripe_customer_id) {
    return user.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    phone: user.phone ?? undefined,
    metadata: {
      userId: user.id,
      source: "beldetailing-app",
    },
  });

  // 🔐 Sauvegarde dans Supabase
  await supabase
    .from("users")
    .update({ stripe_customer_id: customer.id })
    .eq("id", user.id);

  return customer.id;
}

/* -----------------------------------------------------
   CREATE SETUP INTENT — Ajouter une carte
----------------------------------------------------- */
export async function createSetupIntent(user) {
  const customerId = await getOrCreateStripeCustomer(user);

  // Ephemeral Key pour iOS
  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customerId },
    { apiVersion: "2023-10-16" }
  );

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    usage: "off_session",
  });

  return {
    customerId,
    ephemeralKeySecret: ephemeralKey.secret,
    setupIntentClientSecret: setupIntent.client_secret,
  };
}

/* -----------------------------------------------------
   LIST PAYMENT METHODS — Cartes enregistrées
----------------------------------------------------- */
export async function listPaymentMethods(user) {
  // 🔁 Toujours relire le user depuis la DB
  const { data: freshUser, error } = await supabase
    .from("users")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  if (error || !freshUser?.stripe_customer_id) {
    return [];
  }

  const customerId = freshUser.stripe_customer_id;

  const customer = await stripe.customers.retrieve(customerId);

  const defaultPmId =
    typeof customer.invoice_settings?.default_payment_method === "string"
      ? customer.invoice_settings.default_payment_method
      : null;

  const paymentMethods = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
  });

  return paymentMethods.data.map(pm => ({
    id: pm.id,
    brand: pm.card.brand,
    last4: pm.card.last4,
    expMonth: pm.card.exp_month,
    expYear: pm.card.exp_year,
    isDefault: pm.id === defaultPmId,
  }));
}


/* -----------------------------------------------------
   LIST PAYMENT TRANSACTIONS — Historique user
----------------------------------------------------- */
export async function listUserTransactions(userId) {
  const { data, error } = await supabase
    .from("payment_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

/* -----------------------------------------------------
   DELETE PAYMENT METHOD — Detach card
----------------------------------------------------- */
export async function detachPaymentMethod(user, paymentMethodId) {
  if (!user.stripe_customer_id) {
    throw new Error("No Stripe customer");
  }

  const customer = await stripe.customers.retrieve(user.stripe_customer_id);

  const defaultPm =
    typeof customer.invoice_settings?.default_payment_method === "string"
      ? customer.invoice_settings.default_payment_method
      : null;

  if (paymentMethodId === defaultPm) {
    throw new Error("Cannot delete default payment method");
  }

  await stripe.paymentMethods.detach(paymentMethodId);

  return true;
}
