// src/services/payment.service.js
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

/* -----------------------------------------------------
   CREATE PAYMENT INTENT — Préautorisation standard
   
   - Si delayTransferToProvider = true (bookings) : capture sur la plateforme, pas de transfer_data.
     Le transfert au détaileur sera fait 3h après l'heure de résa (cron). Commission NIOS gardée sur la plateforme.
   - Sinon : transfer_data + application_fee_amount (transfert immédiat au détaileur à la capture).
----------------------------------------------------- */
export async function createPaymentIntent({
  amount,
  currency,
  user,
  providerStripeAccountId = null,
  commissionRate = 0.10,
  commissionAmount = null, // Optionnel : commission en euros (ex. cash 10% du total)
  delayTransferToProvider = false, // true = capture plateforme, transfert détaileur plus tard (3h après résa)
}) {
  const customerId = await getOrCreateStripeCustomer(user);

  const amountInCents = Math.round(amount * 100);
  let applicationFeeAmount = null;
  const useImmediateTransfer = providerStripeAccountId && !delayTransferToProvider;

  if (useImmediateTransfer) {
    if (commissionAmount != null && commissionAmount > 0) {
      const feeCents = Math.round(commissionAmount * 100);
      applicationFeeAmount = Math.min(feeCents, amountInCents);
    } else {
      applicationFeeAmount = Math.round(amountInCents * commissionRate);
    }
  }

  const paymentIntentPayload = {
    amount: amountInCents,
    currency,
    customer: customerId,
    capture_method: "manual",
    automatic_payment_methods: {
      enabled: true,
    },
    metadata: {
      userId: user.id,
      source: "beldetailing-app",
      type: "booking",
    },
  };

  // Transfert immédiat (ancien comportement) : transfer_data + application_fee
  if (useImmediateTransfer && applicationFeeAmount > 0) {
    paymentIntentPayload.transfer_data = {
      destination: providerStripeAccountId,
    };
    paymentIntentPayload.application_fee_amount = applicationFeeAmount;
    paymentIntentPayload.metadata.providerStripeAccountId = providerStripeAccountId;
    paymentIntentPayload.metadata.commissionAmount = applicationFeeAmount.toString();
    paymentIntentPayload.metadata.commissionRate = commissionRate.toString();
    console.log(`✅ [PAYMENT] Using Stripe Connect (immediate): destination=${providerStripeAccountId}, commission=${applicationFeeAmount} cents`);
  }

  // delayTransferToProvider : pas de transfer_data → capture sur la plateforme, transfert 3h après résa (cron)
  if (providerStripeAccountId && delayTransferToProvider) {
    paymentIntentPayload.metadata.providerStripeAccountId = providerStripeAccountId;
    paymentIntentPayload.metadata.delayTransferToProvider = "true";
    console.log(`✅ [PAYMENT] Booking: capture on platform, transfer to provider 3h after booking time`);
  }

  const stripeIntent = await stripe.paymentIntents.create(paymentIntentPayload);

  return {
    id: stripeIntent.id,
    clientSecret: stripeIntent.client_secret,
    amount,
    currency,
    status: stripeIntent.status,
    applicationFeeAmount: applicationFeeAmount ? applicationFeeAmount / 100 : null, // ✅ Retourner en euros
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
    // ✅ Capture automatique pour les orders (paiement immédiat)
    capture_method: "automatic",
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
   GET CHARGE ID — Pour transfert différé (bookings: transfert 3h après résa)
----------------------------------------------------- */
export async function getChargeIdFromPaymentIntent(paymentIntentId) {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    const chargeId = pi.latest_charge;
    return typeof chargeId === "string" ? chargeId : null;
  } catch (err) {
    console.error("[STRIPE ERROR - getChargeIdFromPaymentIntent]", err);
    return null;
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
